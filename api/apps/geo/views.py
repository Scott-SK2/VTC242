from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.exceptions import ApiError, NotFound
from apps.common.geo import point

from . import autocomplete
from .models import Zone
from .serializers import ZoneSerializer


def _float(value, name):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        raise ApiError(f"Paramètre {name} invalide.", code="validation_error")


class AutocompleteView(APIView):
    def get(self, request):
        q = request.query_params.get("q", "")
        lat = _float(request.query_params.get("lat"), "lat")
        lng = _float(request.query_params.get("lng"), "lng")
        return Response({"results": autocomplete.search(q, lat, lng)})


class ZoneResolveView(APIView):
    permission_classes = (AllowAny,)

    def get(self, request):
        lat = _float(request.query_params.get("lat"), "lat")
        lng = _float(request.query_params.get("lng"), "lng")
        if lat is None or lng is None:
            raise ApiError("lat et lng requis.", code="validation_error")
        zone = Zone.resolve(point(lat, lng))
        if zone is None:
            raise NotFound("Aucune zone de service ne couvre ce point.", code="out_of_zone")
        return Response(ZoneSerializer(zone).data)
