import unittest

from backend.app.services.prompts.ai_canvas import AI_CANVAS_EDIT_INSTRUCTIONS


class AiCanvasPromptTests(unittest.TestCase):
    def test_prompt_includes_current_recommendation_commands(self):
        for command in [
            "마무리 다듬기",
            "수준 조정 - 쉽게",
            "수준 조정 - 전문적으로",
            "길이 조절 - 짧게",
            "길이 조절 - 길게",
            "정리 보강 - 구조화",
            "정리 보강 - 핵심만",
            "정리 보강 - 오류 의심 표시",
        ]:
            self.assertIn(command, AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_includes_structured_recommendation_modes(self):
        for mode in [
            "polish",
            "simplify",
            "professionalize",
            "shorten",
            "expand",
            "restructure",
            "extract_key_points",
            "mark_uncertain",
            "aiCanvasUncertain",
        ]:
            self.assertIn(mode, AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_maps_structured_modes_to_korean_commands(self):
        expected_mappings = [
            'polish means "마무리 다듬기"',
            'simplify means "수준 조정 - 쉽게"',
            'professionalize means "수준 조정 - 전문적으로"',
            'shorten means "길이 조절 - 짧게"',
            'expand means "길이 조절 - 길게"',
            'restructure means "정리 보강 - 구조화"',
            'extract_key_points means "정리 보강 - 핵심만"',
            'mark_uncertain means "정리 보강 - 오류 의심 표시"',
        ]
        for mapping in expected_mappings:
            self.assertIn(mapping, AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_does_not_include_removed_current_page_recommendation_mode(self):
        self.assertNotIn("정리 보강 - 현재 페이지 보강", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertNotIn("enrich_from_current_context", AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_includes_study_enrichment_policy_phrases(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        for phrase in [
            "selected region image",
            "current page's extracted PDF text",
            "adjacent pages",
            "Canvas is empty",
            "bulletList",
            "orderedList",
            "horizontalRule",
            "확인 필요",
            "Do not imply that the full PDF was read",
        ]:
            self.assertIn(phrase, prompt)

    def test_prompt_enforces_json_only_output_contract(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("JSON object", prompt)
        self.assertIn("operations", prompt)
        self.assertIn("No code fences", prompt)
        self.assertIn("No commentary outside JSON", prompt)
        self.assertIn("must not be a Markdown document", prompt)

    def test_prompt_lists_supported_operations(self):
        for operation in ["insert_after", "insert_before", "replace", "delete"]:
            self.assertIn(operation, AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_lists_supported_tiptap_nodes(self):
        for node_type in [
            "paragraph",
            "heading",
            "bulletList",
            "orderedList",
            "listItem",
            "codeBlock",
            "horizontalRule",
            "text",
        ]:
            self.assertIn(node_type, AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_includes_block_id_safety_rules(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("attrs.blockId", prompt)
        self.assertIn("Reuse an existing blockId only when replacing the same block", prompt)
        self.assertIn("New blocks need new blockId values", prompt)

    def test_prompt_includes_structure_preservation_rules(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Preserve heading/list structure", prompt)
        self.assertIn("Preserve indentLevel", prompt)
        self.assertIn("Preserve markerless", prompt)
        self.assertIn("Preserve nested list hierarchy", prompt)

    def test_prompt_includes_hallucination_prevention_rules(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Do not invent formulas", prompt)
        self.assertIn("Do not invent dates", prompt)
        self.assertIn("Do not invent page numbers", prompt)
        self.assertIn("Do not invent exam predictions", prompt)
        self.assertIn("Recent conversation is not factual study evidence", prompt)

    def test_prompt_includes_insufficient_context_fallback(self):
        self.assertIn("확인 필요", AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_includes_shortening_target(self):
        self.assertIn("40-60%", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("Combine related details into fewer sentences", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("do not keep one shortened sentence for every original sentence", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("Do not keep the same paragraph-by-paragraph shape", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("prefer a bulletList with one concise item per concept", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("body paragraph structure may be converted to a compact bulletList", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("Preserve cause/effect direction exactly when shortening", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("must not keep a three-paragraph input as three similarly detailed rewritten paragraphs", AI_CANVAS_EDIT_INSTRUCTIONS)
        self.assertIn("3-5 compact bullets or 1-2 short paragraphs", AI_CANVAS_EDIT_INSTRUCTIONS)

    def test_prompt_includes_whole_document_replacement_safety(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Avoid replacing the whole document", prompt)
        self.assertIn("do not replace the whole document unless explicitly requested", prompt)

    def test_prompt_includes_selection_scoped_recommendation_rules(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Context scope is \"selection\"", prompt)
        self.assertIn("Selected block ids", prompt)
        self.assertIn("do not rewrite unselected Canvas blocks", prompt)

    def test_prompt_includes_consistent_whole_target_recommendation_rules(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("apply the chosen mode consistently across all relevant top-level sections", prompt)
        self.assertIn("do not polish only the first section", prompt)
        self.assertIn("do not compress only the first section", prompt)

    def test_prompt_includes_real_canvas_structure_guidance(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Prefer real Tiptap structure over plain text", prompt)
        self.assertIn("bulletList items with bold key term labels", prompt)
        self.assertIn("Avoid pseudo-lists", prompt)

    def test_prompt_includes_uncertain_mark_guidance(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("aiCanvasUncertain", prompt)
        self.assertIn('{"type":"aiCanvasUncertain"}', prompt)
        self.assertIn("render as a red warning", prompt)
        self.assertIn("instead of adding a duplicate", prompt)
        self.assertIn("Do not rewrite uncertain claims into corrected claims", prompt)
        self.assertIn("keep the paragraph text intact", prompt)

    def test_prompt_preserves_cautious_protocol_claims(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Do not make cautious source wording more absolute", prompt)
        self.assertIn("always faster", prompt)
        self.assertIn("빠를 수 있다", prompt)

    def test_prompt_includes_recommendation_output_templates(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Recommendation output templates", prompt)
        self.assertIn("Polish: heading cleanup", prompt)
        self.assertIn("Restructure: heading hierarchy", prompt)
        self.assertIn("Extract key points: heading plus bulletList nodes by default", prompt)
        self.assertIn("usually 4-6 total study-critical bullets for one topic", prompt)
        self.assertIn("Mark uncertain: preserve original content", prompt)
        self.assertIn("not one flat list item per concept", prompt)

    def test_prompt_includes_recommendation_quality_gates(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Quality gates for recommendation actions", prompt)
        self.assertIn("Multi-section targets must receive balanced treatment", prompt)
        self.assertIn("must not duplicate existing 확인 필요 markers", prompt)

    def test_prompt_requires_key_points_to_use_bullet_lists(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Use bulletList nodes by default when the target has multiple sentences", prompt)
        self.assertIn("Do not return a series of shortened paragraph nodes", prompt)
        self.assertIn("The returned operations must include at least one bulletList or orderedList node", prompt)
        self.assertIn("one compact bulletList with about 4-6 total bullets", prompt)
        self.assertIn("exactly one bulletList with 4-6 listItem nodes", prompt)
        self.assertIn("If the draft has more than 6 bullets for one topic", prompt)
        self.assertIn("Merge repeated advantage/disadvantage or conclusion bullets", prompt)
        self.assertIn("no list node is invalid", prompt)
        self.assertIn("hard maximum for one-topic extract_key_points", prompt)
        self.assertIn("Merge term + detail pairs into one bullet", prompt)
        self.assertIn("not 6 per compared item", prompt)
        self.assertIn("process/thread-style comparisons", prompt)
        self.assertIn("delete those later redundant body paragraphs", prompt)
        self.assertIn("invalid to leave original body paragraphs after the extracted key-point list", prompt)
        self.assertIn("existing heading plus one compact bulletList", prompt)
        self.assertIn("do not split key points into multiple bulletList nodes", prompt)
        self.assertIn("must not replace each original paragraph with its own bulletList", prompt)
        self.assertIn("Do not mirror source paragraph boundaries", prompt)
        self.assertIn("under about 55 Korean characters", prompt)

    def test_prompt_prevents_unsupported_expand_terms(self):
        prompt = AI_CANVAS_EDIT_INSTRUCTIONS

        self.assertIn("Expand must not introduce named algorithms", prompt)
        self.assertIn("solely from general knowledge", prompt)
        self.assertIn("omit it or add a concise \"확인 필요\" marker", prompt)


if __name__ == "__main__":
    unittest.main()
