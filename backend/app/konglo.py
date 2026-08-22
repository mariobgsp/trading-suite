"""Konglo — broker-flow aggregated per konglomerat / taipan group.

BidBot-style grouping: IDX tickers roll up into well-known Indonesian
conglomerate families, and each group shows saham count, average price
move, and aggregate official net foreign flow (the one honest per-stock
flow signal IDX publishes).

Membership verified against IDX/KSEI filings and financial press,
Feb 2026. Deliberately EXCLUDED (would misattribute flow):
- SOE-controlled: SMGR, KRAS, ELSA (Pertamina), INET pre-IPO Icon+ era
- Foreign-controlled: HMSP (Philip Morris); Astra kept as Jardine-held legacy bucket
- No clear konglo controller: TOBA (offshore Highland Strategic), SSIA, EKAD
- Divested / renamed away: HITS (Tommy sold all Jan 2026), LPIN (now Multi Prima),
  DOID stays but is BUMA Internasional under Northstar, GEMS (sold to Geo Energy)
- Not actually Salim: DMND (Chen family), INAI (Indal Aluminium)
"""

from __future__ import annotations

from typing import Any


def _num(val: Any, cast: type[float | int]) -> float | int | None:
    """Guarded numeric coercion — repo convention (cf. validator._safe_float)."""
    try:
        return cast(val)
    except (TypeError, ValueError):
        return None


# ponytail: static curated map instead of scraping ownership registries —
# swap in an SEC/OJK holdings feed if per-group accuracy ever matters.
# Ownership %s drift with rights issues/placements; re-verify against LBRE
# monthly registrar reports before trusting exact stakes.
KONGLO_GROUPS: dict[str, list[str]] = {
    # ── Legacy conglomerates ──
    "Astra Group": ["ASII", "AALI", "AUTO", "UNTR"],  # Jardine C&C holds 50.11% of ASII
    "Aburizal Bakrie": ["BUMI", "BNBR", "ENRG", "BRMS", "ELTY", "UNSP", "BULL", "VISI"],
    "Anthony Salim": ["INDF", "ICBP", "SIMP", "IMJS", "PANI"],  # PANI = Salim × Agung Sedayu JV
    "James Riady (Lippo)": ["LPKR", "LPCK", "LPPF", "GMTD"],
    "Widjaja Family (Sinarmas)": ["TKIM", "INKP", "SMAR", "SMMA", "DSSA", "BSDE", "BSIM"],
    "Djarum (Hartono)": ["BBCA"],  # Dwimuria Investama 54.94%
    "Wonowidjojo (Gudang Garam)": ["GGRM"],
    "Ciputra Family": ["CTRA"],
    "Eka Tjandranegara (Mulia)": ["MLIA"],
    "Gunawan (Panin)": ["PNBN", "PNLF"],
    # ── Coal & energy taipans ──
    "Garibaldi Thohir (Adaro)": ["ADRO", "AADI"],  # ADRO = Alamtri holding; AADI listed Dec 2024
    "Low Tuck Kwong": ["BYAN"],  # sold his ADRO stake in the Nov 2022 buyout
    "Saratoga/Merdeka (E. Soeryadjaya)": ["MDKA", "MBMA"],  # Saratoga ~19.4% vs GIB ~7.5% in MDKA
    "Kiki Barki (Harum)": ["HRUM"],
    "Teddy Rachmat (Triputra)": ["TAPG"],
    # ── New-economy / diversified ──
    "Prajogo Pangestu (Barito)": ["BRPT", "TPIA", "CUAN", "PTRO", "BREN", "CDIA"],
    "Happy Hapsoro": [
        "RAJA",
        "RATU",
        "BUVA",
        "PADI",
    ],  # PADI via SBM tender, controller transition 2025-26
    "Hashim Djojohadikusumo": ["WIFI"],  # via Investasi Sukses Bersama 54.42%
    "Adhie Massardi": ["INET", "PADA"],  # INET ~58%; INET bought 53.57% of PADA Feb 2026
    "Harita Group": ["NCKL"],
    "Northstar (Samin Tan)": ["DOID", "APEX"],  # DOID renamed BUMA Internasional Grup
    "Tommy Soeharto (Humpuss)": ["HOKI"],  # HITS fully divested Jan 2026
    # ── Media, banks, consumer ──
    "Hary Tanoe (MNC)": ["BHIT", "MNCN", "BCAP", "IPCM", "VIVA", "MSIN"],
    "Chairul Tanjung (CT Corp)": ["MEGA", "BBHI"],
    "Dato Sri Tahir (Mayapada)": ["MAYA", "MPRO"],
    "Eddy Kusnadi Sariaatmadja": ["AKRA", "AMRT", "EMTK", "SCMA"],  # EMTK controls SCMA ~74%
    "Otto Toto Sugiri": ["DCII"],
    "Hermanto Tanoko": ["ACST"],
    "Peter Sondakh (Rajawali)": ["ARCI"],
    "Murdaya Po (CCM)": ["MKPI", "WOOD"],
    "Wings Group": ["ADES"],  # via Waters Partners Bottling ~91.5%
}


def konglo_overview() -> dict[str, Any]:
    """Aggregate the market-wide foreign-flow snapshot per konglomerate."""
    # Local import avoids pulling idx/db at module load (same pattern as main.py).
    from app.idx import foreign_flow_universe

    snap = foreign_flow_universe()
    rows = {str(r["ticker"]): r for r in snap.get("rows", [])}

    groups: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name, tickers in KONGLO_GROUPS.items():
        members: list[dict[str, Any]] = []
        for t in tickers:
            row = rows.get(t)
            if row is None:
                continue
            seen.add(t)
            members.append(
                {
                    "ticker": row["ticker"],
                    "price": row.get("price"),
                    "change_percent": row.get("change_percent"),
                    "net_foreign_idr": row.get("net_foreign_idr"),
                }
            )
        if not members:
            continue
        chg = [c for c in (_num(m.get("change_percent"), float) for m in members) if c is not None]
        net = sum(
            _num(m.get("net_foreign_idr"), int) or 0  # type: ignore[arg-type]
            for m in members
        )
        groups.append(
            {
                "group": name,
                "count_saham": len(members),
                "avg_change_percent": round(sum(chg) / len(chg), 2) if chg else None,
                "net_foreign_idr": net,
                "members": members,
            }
        )

    groups.sort(key=lambda g: abs(g["net_foreign_idr"]), reverse=True)
    return {
        "available": snap.get("available", True),
        "error": snap.get("error"),
        "groups_counted": len(groups),
        "tickers_mapped": len(seen),
        "groups": groups,
    }
