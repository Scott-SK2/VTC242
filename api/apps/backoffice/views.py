from __future__ import annotations

import csv
import io

import pyotp
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import services as account_services
from apps.accounts.authentication import issue_tokens
from apps.accounts.models import TOTP_ROLES, User
from apps.accounts.serializers import UserSerializer
from apps.common.exceptions import ApiError, NotFound
from apps.common.sms import send_sms
from apps.drivers.models import DocumentStatus, Driver, DriverDocument, DriverStatus, Vehicle
from apps.drivers.serializers import DriverDocumentSerializer
from apps.geo.models import PointOfInterest, PricingRule, Zone
from apps.geo.pricing import compute_price
from apps.geo.serializers import (
    AdminZoneSerializer,
    PointOfInterestSerializer,
    PricingRuleSerializer,
)
from apps.payments import reconciliation
from apps.payments import services as payment_services
from apps.payments.models import PayoutRequest, WalletTransaction
from apps.payments.serializers import PayoutRequestSerializer, TransactionSerializer
from apps.rides import services as ride_services
from apps.rides.models import Dispute, Ride
from apps.rides.serializers import MessageSerializer
from apps.safety import services as safety
from apps.safety.models import Alert

from . import services
from .audit import audit
from .models import AuditLog
from .permissions import ADMIN_FINANCE, ADMIN_ONLY, ADMIN_SUPPORT, StaffPermission
from .serializers import (
    AdminDisputeSerializer,
    AdminDriverSerializer,
    AdminPassengerSerializer,
    AdminRideSerializer,
    AlertSerializer,
    AuditLogSerializer,
    DocumentReviewSerializer,
    ReasonSerializer,
    ResolveDisputeSerializer,
    SimulateSerializer,
    StaffUserCreateSerializer,
    TotpVerifySerializer,
)


class StaffView(APIView):
    permission_classes = (StaffPermission,)


class StaffListView(ListAPIView):
    permission_classes = (StaffPermission,)


# --- TOTP (section 9) ------------------------------------------------------------------
class TotpSetupView(APIView):
    """Le setup ne requiert pas encore le TOTP (sinon impossible de l'activer)."""

    def post(self, request):
        user = request.user
        if user.role not in TOTP_ROLES:
            raise ApiError(
                "TOTP réservé aux rôles admin et finance.", code="forbidden", status_code=403
            )
        secret = pyotp.random_base32()
        user.totp_secret = secret
        user.totp_enabled = False
        user.save(update_fields=["totp_secret", "totp_enabled"])
        url = pyotp.TOTP(secret).provisioning_uri(
            name=user.phone_number, issuer_name="VTC 242 Back-office"
        )
        return Response({"secret": secret, "otpauth_url": url})


class TotpVerifyView(APIView):
    def post(self, request):
        user = request.user
        ser = TotpVerifySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if not user.totp_secret:
            raise ApiError("Configurez d'abord le TOTP.", code="totp_not_setup")
        if not pyotp.TOTP(user.totp_secret).verify(ser.validated_data["code"], valid_window=1):
            raise ApiError("Code TOTP invalide.", code="invalid_totp")
        if not user.totp_enabled:
            user.totp_enabled = True
            user.save(update_fields=["totp_enabled"])
        return Response({**issue_tokens(user, totp_ok=True), "user": UserSerializer(user).data})


# --- supervision -----------------------------------------------------------------------
class DashboardView(StaffView):
    def get(self, request):
        return Response(services.dashboard())


class FleetView(StaffView):
    def get(self, request):
        return Response(services.fleet())


class AlertListView(StaffListView):
    serializer_class = AlertSerializer

    def get_queryset(self):
        qs = Alert.objects.select_related("ride__driver__user", "ride__passenger")
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        return qs


class AlertAckView(StaffView):
    def post(self, request, alert_id):
        alert = get_object_or_404(Alert, pk=alert_id)
        safety.acknowledge_alert(alert, request.user)
        audit(request, "alert.acknowledge", alert)
        return Response(AlertSerializer(alert).data)


class RideListView(StaffListView):
    serializer_class = AdminRideSerializer

    def get_queryset(self):
        qs = Ride.objects.select_related(
            "driver__user", "vehicle", "passenger", "zone", "pricing_rule"
        ).order_by("-requested_at")
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("passenger_id"):
            qs = qs.filter(passenger_id=p["passenger_id"])
        if p.get("driver_id"):
            qs = qs.filter(driver_id=p["driver_id"])
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(
                Q(passenger__phone_number__icontains=q)
                | Q(passenger__first_name__icontains=q)
                | Q(driver__user__phone_number__icontains=q)
                | Q(id__istartswith=q)
            )
        if p.get("from"):
            qs = qs.filter(requested_at__date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(requested_at__date__lte=p["to"])
        return qs


class RideDetailView(StaffView):
    def get(self, request, ride_id):
        ride = get_object_or_404(
            Ride.objects.select_related(
                "driver__user", "vehicle", "passenger", "zone", "pricing_rule"
            ),
            pk=ride_id,
        )
        return Response(AdminRideSerializer(ride, context={"detail": True, "role": "admin"}).data)


class RideMessagesView(StaffView):
    def get(self, request, ride_id):
        ride = get_object_or_404(Ride, pk=ride_id)
        return Response({"results": MessageSerializer(ride.messages.all(), many=True).data})

    def post(self, request, ride_id):
        ride = get_object_or_404(Ride, pk=ride_id)
        msg = ride_services.send_message(
            ride, request.user, request.data.get("body"), request.data.get("preset")
        )
        audit(request, "ride.message", ride, {"body": msg.body})
        return Response(MessageSerializer(msg).data, status=201)


class RideCancelView(StaffView):
    roles = ADMIN_SUPPORT

    def post(self, request, ride_id):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ride = ride_services.cancel(
            ride_id, request.user, ser.validated_data["reason"] or "Annulée par le support"
        )
        audit(request, "ride.cancel", ride, {"reason": ser.validated_data["reason"]})
        return Response(AdminRideSerializer(ride, context={"detail": True}).data)


# --- chauffeurs (F-53) -----------------------------------------------------------------
class DriverListView(StaffListView):
    serializer_class = AdminDriverSerializer

    def get_queryset(self):
        qs = Driver.objects.select_related("user", "active_vehicle", "zone").prefetch_related(
            "documents", "vehicles"
        )
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(
                Q(user__phone_number__icontains=q)
                | Q(user__first_name__icontains=q)
                | Q(user__last_name__icontains=q)
                | Q(vehicles__license_plate__icontains=q)
            ).distinct()
        if p.get("online"):
            qs = qs.filter(is_online=True)
        return qs.order_by("-created_at")


class DriverDetailView(StaffView):
    def get(self, request, driver_id):
        driver = get_object_or_404(Driver.objects.select_related("user"), pk=driver_id)
        return Response(AdminDriverSerializer(driver).data)


class DriverActionView(StaffView):
    roles = ADMIN_SUPPORT

    def post(self, request, driver_id, action):
        driver = get_object_or_404(Driver.objects.select_related("user"), pk=driver_id)
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        reason = ser.validated_data["reason"]
        before = driver.status
        if action == "approve":
            driver.status = DriverStatus.APPROVED
            driver.status_reason = None
            Vehicle.objects.filter(driver=driver).update(is_verified=True)
            driver.documents.filter(status=DocumentStatus.PENDING).update(
                status=DocumentStatus.APPROVED, reviewed_by=request.user, reviewed_at=timezone.now()
            )
            send_sms(
                driver.user.phone_number,
                "VTC 242 : votre compte chauffeur est validé. Vous pouvez passer en ligne.",
            )
        elif action == "reject":
            driver.status = DriverStatus.REJECTED
            driver.status_reason = reason
            send_sms(
                driver.user.phone_number,
                f"VTC 242 : votre dossier chauffeur a été refusé. Motif : {reason}",
            )
        elif action == "suspend":
            driver.status = DriverStatus.SUSPENDED
            driver.status_reason = reason
            from apps.drivers import services as driver_services

            driver_services.set_online(driver, False)
            account_services.logout_everywhere(driver.user)
            send_sms(
                driver.user.phone_number, f"VTC 242 : votre compte est suspendu. Motif : {reason}"
            )
        elif action == "reinstate":
            driver.status = DriverStatus.APPROVED
            driver.status_reason = None
        else:
            raise NotFound("Action inconnue.")
        driver.save(update_fields=["status", "status_reason", "updated_at"])
        audit(
            request,
            f"driver.{action}",
            driver,
            {"from": before, "to": driver.status, "reason": reason},
        )
        return Response(AdminDriverSerializer(driver).data)


class DocumentReviewView(StaffView):
    roles = ADMIN_SUPPORT

    def post(self, request, document_id):
        doc = get_object_or_404(DriverDocument, pk=document_id)
        ser = DocumentReviewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        doc.status = ser.validated_data["status"]
        doc.review_note = ser.validated_data["note"]
        doc.reviewed_by = request.user
        doc.reviewed_at = timezone.now()
        doc.save()
        if doc.type == "vehicle_photo" and doc.status == DocumentStatus.APPROVED:
            Vehicle.objects.filter(driver=doc.driver).update(is_verified=True)
        audit(request, "document.review", doc, {"status": doc.status, "note": doc.review_note})
        return Response(DriverDocumentSerializer(doc).data)


# --- passagers (F-54) ------------------------------------------------------------------
class PassengerListView(StaffListView):
    serializer_class = AdminPassengerSerializer

    def get_queryset(self):
        qs = User.objects.filter(role="passenger").select_related("wallet")
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(
                Q(phone_number__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
            )
        return qs.order_by("-created_at")


class PassengerDetailView(StaffView):
    def get(self, request, user_id):
        user = get_object_or_404(User, pk=user_id, role="passenger")
        rides = Ride.objects.filter(passenger=user).select_related(
            "driver__user", "vehicle", "zone", "pricing_rule"
        )[:50]
        return Response(
            {
                **AdminPassengerSerializer(user).data,
                "rides": AdminRideSerializer(rides, many=True).data,
            }
        )


class PassengerActionView(StaffView):
    roles = ADMIN_SUPPORT

    def post(self, request, user_id, action):
        user = get_object_or_404(User, pk=user_id)
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        reason = ser.validated_data["reason"]
        if action == "block":
            user.is_active = False
            user.blocked_reason = reason
            user.save(update_fields=["is_active", "blocked_reason"])
            account_services.logout_everywhere(user)
        elif action == "unblock":
            user.is_active = True
            user.blocked_reason = None
            user.save(update_fields=["is_active", "blocked_reason"])
        elif action == "logout-all":
            account_services.logout_everywhere(user)
        else:
            raise NotFound("Action inconnue.")
        audit(request, f"user.{action}", user, {"reason": reason})
        return Response(AdminPassengerSerializer(user).data)


# --- tarifs (F-55) ----------------------------------------------------------------------
class PricingRuleListView(StaffListView):
    serializer_class = PricingRuleSerializer

    def get_queryset(self):
        qs = PricingRule.objects.select_related("zone").order_by(
            "zone__name", "category", "-effective_from"
        )
        p = self.request.query_params
        if p.get("zone_id"):
            qs = qs.filter(zone_id=p["zone_id"])
        if p.get("category"):
            qs = qs.filter(category=p["category"])
        return qs

    def post(self, request):
        if request.user.role not in ADMIN_FINANCE:
            raise ApiError("Rôle insuffisant.", code="forbidden", status_code=403)
        ser = PricingRuleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        rule = ser.save()
        # ferme la règle précédente à la date d'effet de la nouvelle
        PricingRule.objects.filter(
            zone=rule.zone, category=rule.category, effective_to__isnull=True
        ).exclude(pk=rule.pk).filter(effective_from__lt=rule.effective_from).update(
            effective_to=rule.effective_from
        )
        audit(request, "pricing_rule.create", rule, ser.data)
        return Response(PricingRuleSerializer(rule).data, status=201)


class PricingRuleDetailView(StaffView):
    roles = ADMIN_FINANCE

    def patch(self, request, rule_id):
        rule = get_object_or_404(PricingRule, pk=rule_id)
        if rule.rides.exists():
            allowed = {"effective_to", "surge_multiplier"}
            if set(request.data.keys()) - allowed:
                raise ApiError(
                    "Règle déjà utilisée : créez une nouvelle version avec une date d'effet.",
                    code="rule_in_use",
                )
        before = PricingRuleSerializer(rule).data
        ser = PricingRuleSerializer(rule, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        audit(request, "pricing_rule.update", rule, {"before": before, "after": ser.data})
        return Response(ser.data)


class PricingSimulateView(StaffView):
    roles = ADMIN_FINANCE

    def post(self, request):
        ser = SimulateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        zone = get_object_or_404(Zone, pk=d["zone_id"])
        rule = PricingRule.active_for(zone, d["category"], d.get("at"))
        if rule is None:
            raise NotFound("Aucune règle active pour cette zone et catégorie.")
        br = compute_price(rule, d["distance_m"], d["duration_s"], d["waiting_seconds"])
        from apps.geo.pricing import commission_for

        return Response(
            {
                "price": str(br.price),
                "commission": str(commission_for(rule, br.price)),
                "rule": PricingRuleSerializer(rule).data,
                "breakdown": br.as_dict(),
            }
        )


# --- zones et POI (F-56, F-57) -----------------------------------------------------------
class ZoneListView(StaffListView):
    serializer_class = AdminZoneSerializer
    queryset = Zone.objects.all().order_by("name")
    pagination_class = None

    def post(self, request):
        if request.user.role not in ADMIN_ONLY:
            raise ApiError("Rôle insuffisant.", code="forbidden", status_code=403)
        ser = AdminZoneSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        zone = ser.save()
        audit(request, "zone.create", zone)
        return Response(AdminZoneSerializer(zone).data, status=201)


class ZoneDetailView(StaffView):
    roles = ADMIN_ONLY

    def patch(self, request, zone_id):
        zone = get_object_or_404(Zone, pk=zone_id)
        ser = AdminZoneSerializer(zone, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        audit(
            request,
            "zone.update",
            zone,
            {k: str(v) for k, v in request.data.items() if k != "polygon"},
        )
        return Response(ser.data)


class PoiListView(StaffListView):
    serializer_class = PointOfInterestSerializer
    roles = ADMIN_SUPPORT

    def get_queryset(self):
        qs = PointOfInterest.objects.select_related("zone").order_by("name")
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(aliases__icontains=q))
        return qs

    def post(self, request):
        ser = PointOfInterestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        poi = ser.save()
        audit(request, "poi.create", poi)
        return Response(PointOfInterestSerializer(poi).data, status=201)


class PoiDetailView(StaffView):
    roles = ADMIN_SUPPORT

    def patch(self, request, poi_id):
        poi = get_object_or_404(PointOfInterest, pk=poi_id)
        ser = PointOfInterestSerializer(poi, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        audit(request, "poi.update", poi)
        return Response(ser.data)

    def delete(self, request, poi_id):
        poi = get_object_or_404(PointOfInterest, pk=poi_id)
        audit(request, "poi.delete", poi, {"name": poi.name})
        poi.delete()
        return Response(status=204)


# --- litiges (F-58) ---------------------------------------------------------------------
class DisputeListView(StaffListView):
    serializer_class = AdminDisputeSerializer

    def get_queryset(self):
        qs = Dispute.objects.select_related(
            "ride__passenger", "ride__driver__user", "ride__zone", "ride__pricing_rule", "opened_by"
        )
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        return qs


class DisputeDetailView(StaffView):
    def get(self, request, dispute_id):
        dispute = get_object_or_404(Dispute.objects.select_related("ride"), pk=dispute_id)
        return Response(AdminDisputeSerializer(dispute, context={"detail": True}).data)


class DisputeResolveView(StaffView):
    roles = ADMIN_FINANCE

    def post(self, request, dispute_id, action):
        dispute = get_object_or_404(Dispute, pk=dispute_id)
        ser = ResolveDisputeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        dispute = ride_services.resolve_dispute(
            dispute,
            request.user,
            d.get("refund_amount"),
            d["resolution"],
            reject=(action == "reject"),
        )
        audit(
            request,
            f"dispute.{action}",
            dispute,
            {"refund": str(dispute.refund_amount or 0), "resolution": d["resolution"]},
        )
        return Response(AdminDisputeSerializer(dispute, context={"detail": True}).data)


# --- finances (F-59) --------------------------------------------------------------------
class FinanceSummaryView(StaffView):
    roles = ADMIN_FINANCE

    def get(self, request):
        return Response(services.finance_summary())


class FinanceTransactionListView(StaffListView):
    roles = ADMIN_FINANCE
    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = WalletTransaction.objects.select_related("ride", "wallet__user")
        p = self.request.query_params
        for f in ("type", "status", "operator"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        if p.get("user_id"):
            qs = qs.filter(wallet__user_id=p["user_id"])
        if p.get("q"):
            qs = qs.filter(
                Q(external_reference__icontains=p["q"])
                | Q(wallet__user__phone_number__icontains=p["q"])
            )
        return qs


class PayoutListView(StaffListView):
    roles = ADMIN_FINANCE
    serializer_class = PayoutRequestSerializer

    def get_queryset(self):
        qs = PayoutRequest.objects.select_related("driver__user", "transaction")
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status__in=status.split(","))
        return qs


class PayoutActionView(StaffView):
    roles = ADMIN_FINANCE

    def post(self, request, payout_id, action):
        req = get_object_or_404(PayoutRequest, pk=payout_id)
        note = request.data.get("note", "")
        if action == "approve":
            req = payment_services.approve_payout(req, request.user)
        elif action == "reject":
            req = payment_services.reject_payout(req, request.user, note)
        else:
            raise NotFound("Action inconnue.")
        audit(request, f"payout.{action}", req, {"amount": str(req.amount), "note": note})
        return Response(PayoutRequestSerializer(req).data)


class ReconciliationImportView(StaffView):
    roles = ADMIN_FINANCE

    def post(self, request):
        f = request.FILES.get("file")
        operator = request.data.get("operator", "mtn")
        if f is None:
            raise ApiError("Fichier CSV requis (champ file).", code="validation_error")
        report = reconciliation.import_statement(operator, f.read(), request.user)
        audit(
            request,
            "reconciliation.import",
            report,
            {"rows": report.rows_total, "matched": report.matched},
        )
        return Response(
            {
                "id": str(report.id),
                "rows_total": report.rows_total,
                "matched": report.matched,
                "mismatched": report.mismatched,
                "missing": report.missing,
            }
        )


class ExportView(StaffView):
    roles = ADMIN_FINANCE

    def get(self, request):
        kind = request.query_params.get("type", "transactions")
        date_from, date_to = request.query_params.get("from"), request.query_params.get("to")
        buf = io.StringIO()
        w = csv.writer(buf)
        if kind == "rides":
            qs = Ride.objects.select_related("passenger", "driver__user").order_by("-requested_at")
            if date_from:
                qs = qs.filter(requested_at__date__gte=date_from)
            if date_to:
                qs = qs.filter(requested_at__date__lte=date_to)
            w.writerow(
                [
                    "id",
                    "status",
                    "category",
                    "payment_method",
                    "passenger",
                    "driver",
                    "requested_at",
                    "completed_at",
                    "final_price",
                    "commission",
                    "driver_earning",
                ]
            )
            for r in qs[:20000]:
                w.writerow(
                    [
                        r.id,
                        r.status,
                        r.category,
                        r.payment_method,
                        r.passenger.phone_number,
                        r.driver.user.phone_number if r.driver else "",
                        r.requested_at.isoformat(),
                        r.completed_at.isoformat() if r.completed_at else "",
                        r.final_price or "",
                        r.commission_amount or "",
                        r.driver_earning or "",
                    ]
                )
        else:
            qs = WalletTransaction.objects.select_related("wallet__user").order_by("-created_at")
            if date_from:
                qs = qs.filter(created_at__date__gte=date_from)
            if date_to:
                qs = qs.filter(created_at__date__lte=date_to)
            w.writerow(
                [
                    "id",
                    "user",
                    "type",
                    "status",
                    "amount",
                    "method",
                    "operator",
                    "external_reference",
                    "ride_id",
                    "created_at",
                    "completed_at",
                ]
            )
            for t in qs[:20000]:
                w.writerow(
                    [
                        t.id,
                        t.wallet.user.phone_number,
                        t.type,
                        t.status,
                        t.amount,
                        t.method,
                        t.operator or "",
                        t.external_reference or "",
                        t.ride_id or "",
                        t.created_at.isoformat(),
                        t.completed_at.isoformat() if t.completed_at else "",
                    ]
                )
        audit(request, "export.csv", kind, {"from": date_from, "to": date_to})
        resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="vtc242-{kind}.csv"'
        return resp


# --- audit et utilisateurs staff (F-60) --------------------------------------------------
class AuditLogListView(StaffListView):
    roles = ADMIN_ONLY
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor")
        p = self.request.query_params
        if p.get("action"):
            qs = qs.filter(action__istartswith=p["action"])
        if p.get("actor_id"):
            qs = qs.filter(actor_id=p["actor_id"])
        return qs


class StaffUserListView(StaffListView):
    roles = ADMIN_ONLY
    serializer_class = UserSerializer

    def get_queryset(self):
        role = self.request.query_params.get("role")
        qs = User.objects.filter(role__in=("admin", "finance", "support"))
        if role:
            qs = qs.filter(role=role)
        return qs.order_by("-created_at")

    def post(self, request):
        ser = StaffUserCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        phone = account_services.normalize_phone(d["phone_number"])
        user, created = User.objects.get_or_create(
            phone_number=phone,
            defaults={
                "first_name": d["first_name"],
                "last_name": d["last_name"],
                "role": d["role"],
            },
        )
        if not created:
            user.role = d["role"]
            user.save(update_fields=["role"])
        audit(request, "user.staff_upsert", user, {"role": d["role"], "created": created})
        return Response(UserSerializer(user).data, status=201 if created else 200)


class StaffUserDetailView(StaffView):
    roles = ADMIN_ONLY

    def patch(self, request, user_id):
        user = get_object_or_404(User, pk=user_id)
        role = request.data.get("role")
        if role in ("admin", "finance", "support", "passenger"):
            user.role = role
        if "is_active" in request.data:
            user.is_active = bool(request.data["is_active"])
        user.save()
        audit(request, "user.update", user, {"role": role, "is_active": user.is_active})
        return Response(UserSerializer(user).data)
