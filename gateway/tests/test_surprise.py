"""Surprise brute et z (T-018)."""

from __future__ import annotations

from decimal import Decimal

from terminal_gateway.surprise import raw_surprise, sigma_floor, z_score


def test_raw_surprise_is_decimal_text():
    assert raw_surprise("0.4", "0.3") == "0.1"
    assert raw_surprise("0.3", "0.3") == "0.0"
    assert raw_surprise("-0.1", "0.2") == "-0.3"
    assert raw_surprise("165", "50") == "115"
    assert raw_surprise("4.1", "4.25") == "-0.15"


def test_raw_surprise_needs_both_values():
    assert raw_surprise("0.4", None) is None
    assert raw_surprise(None, "0.3") is None
    assert raw_surprise("0.4", "n/a") is None


def test_sigma_floor_is_half_the_last_published_digit():
    assert sigma_floor("0.4") == Decimal("0.05")
    assert sigma_floor("165") == Decimal("0.5")


def test_z_needs_eight_releases():
    z = z_score("0.1", ["0.1"] * 7, "0.4")
    assert z.z is None and z.reason == "historique insuffisant (7/8)" and z.n == 7


def test_z_without_forecast():
    assert z_score(None, ["0.1"] * 10, "0.4").reason == "pas de prévision avant la publication"


def test_z_uses_sigma_floor_when_history_is_flat():
    z = z_score("0.1", ["0.0"] * 8, "0.4")  # sigma = 0 -> plancher 0.05
    assert z.z == "2.00" and z.provisional


def test_z_provisional_until_24():
    hist = ["0.1", "-0.1"] * 12  # stdev = 0.1022…
    z = z_score("0.2", hist, "0.4")
    assert z.n == 24 and not z.provisional and z.z == "1.96"
    assert z_score("0.2", hist[:-1], "0.4").provisional
