from agent import parse_metadata


def test_parse_metadata_accepts_valid_json():
    assert parse_metadata('{"podId":"demo-pod","identity":"yahya","sessionId":"s1"}') == {
        "podId": "demo-pod",
        "identity": "yahya",
        "sessionId": "s1",
    }


def test_parse_metadata_handles_bad_json():
    assert parse_metadata("not json") == {}
