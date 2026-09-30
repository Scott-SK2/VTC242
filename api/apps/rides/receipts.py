"""Reçu PDF minimal sans dépendance externe (F-25)."""

from __future__ import annotations

import zlib


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _latin(text: str) -> str:
    return text.encode("latin-1", "replace").decode("latin-1")


def build_receipt_pdf(ride) -> bytes:
    lines = [
        "VTC 242 - Recu de course",
        f"Course : {ride.id}",
        f"Date : {(ride.completed_at or ride.requested_at):%d/%m/%Y %H:%M}",
        f"Depart : {ride.pickup_address}",
        f"Arrivee : {ride.dropoff_address}",
        f"Categorie : {ride.category}",
        f"Distance : {(ride.actual_distance_m or ride.planned_distance_m or 0) / 1000:.1f} km",
        f"Duree : {ride.ride_seconds // 60} min (attente {ride.waiting_seconds // 60} min)",
        f"Paiement : {ride.payment_method}",
        f"Prix : {int(ride.final_price or 0):,} F".replace(",", " "),
        f"Chauffeur : {ride.driver.user.first_name if ride.driver else '-'}",
        "Vehicule : "
        + (
            f"{ride.vehicle.brand} {ride.vehicle.model} {ride.vehicle.license_plate}"
            if ride.vehicle
            else "-"
        ),
        f"Statut : {ride.status}",
        "",
        "Merci d'avoir voyage avec VTC 242 - Brazzaville",
    ]
    content = ["BT", "/F1 18 Tf", "50 790 Td", f"({_escape(_latin(lines[0]))}) Tj", "/F1 12 Tf"]
    y = 0
    for line in lines[1:]:
        y -= 22
        content.append(f"0 -22 Td ({_escape(_latin(line))}) Tj")
    content.append("ET")
    stream = zlib.compress("\n".join(content).encode("latin-1"))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" /Filter /FlateDecode >>\nstream\n"
        + stream
        + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)
