from agent import PodManLiveAgent, parse_metadata


def test_parse_metadata_accepts_valid_json():
    assert parse_metadata('{"podId":"demo-pod","identity":"yahya","sessionId":"s1"}') == {
        "podId": "demo-pod",
        "identity": "yahya",
        "sessionId": "s1",
    }


def test_parse_metadata_handles_bad_json():
    assert parse_metadata("not json") == {}


def test_hermes_terminal_events_always_speak():
    agent = PodManLiveAgent("demo-pod", "yahya", "s1", "room")
    assert agent.should_speak_progress({"type": "completed"}) is True
    assert agent.should_speak_progress({"type": "failed"}) is True
    assert agent.should_speak_progress({"type": "aborted"}) is True


def test_hermes_progress_is_throttled():
    agent = PodManLiveAgent("demo-pod", "yahya", "s1", "room")
    assert agent.should_speak_progress({"type": "heartbeat"}) is True
    assert agent.should_speak_progress({"type": "step_started"}) is False
