from img_preprocessing.crop.yolo_world_detector import clip_xyxy, parse_classes, score_detection


def test_parse_classes_accepts_comma_and_space_groups() -> None:
    result = parse_classes(["whiteboard, blackboard", "projector screen"])

    assert result == ["whiteboard", "blackboard", "projector screen"]


def test_clip_xyxy_clamps_to_image_bounds() -> None:
    result = clip_xyxy([-10.0, 5.0, 200.0, 130.0], (100, 120, 3))

    assert result == [0.0, 5.0, 119.0, 99.0]


def test_score_detection_prefers_larger_relevant_surface() -> None:
    image_shape = (1000, 1000, 3)
    small = score_detection("chalkboard", 0.5, [100.0, 100.0, 250.0, 250.0], image_shape)
    large = score_detection("chalkboard", 0.5, [100.0, 100.0, 800.0, 750.0], image_shape)

    assert large > small
