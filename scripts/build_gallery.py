#!/usr/bin/env python3
"""Build docs/gallery.json from the existing catalog.

Reads data/cases.json, prompt files, and notes. Does not modify those sources,
does not download media, and writes only URL metadata plus prompt text that is
already in the repository.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "data" / "cases.json"
OUT = ROOT / "docs" / "gallery.json"

EXPECTED_EXCERPTS = {
    "2118519274482586001": "（好きな動き）のループGIFを作成してください",
    "2118265895613346263": "strictly NO white sticker border, NO white outline",
    "2118369182458708217": "创建一个gif，按照附图的动作顺序生成",
}


def prompt_body(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    for marker in ("## 提示词正文引用\n", "## 原文\n"):
        if marker in text:
            body = text.split(marker, 1)[1].strip("\n")
            if not body.strip():
                raise SystemExit(f"empty prompt section: {path}")
            return body
    quotes = []
    for line in text.splitlines():
        if line.startswith("> "):
            quotes.append(line[2:])
        elif line.startswith(">"):
            quotes.append(line[1:].lstrip())
    body = "\n".join(quotes).strip("\n")
    if not body:
        raise SystemExit(f"no original prompt text: {path}")
    return body


def section_with_post(notes: str, post_id: str) -> str:
    parts = re.split(r"\n(?=## )", notes)
    hits = [part for part in parts if post_id in part]
    if len(hits) != 1:
        raise SystemExit(f"{post_id} matched {len(hits)} note sections")
    return hits[0]


def excerpt_for(case: dict) -> str:
    if case["prompt_level"] != "节选":
        return ""
    notes = (ROOT / case["notes_file"]).read_text(encoding="utf-8")
    section = section_with_post(notes, case["post_id"])
    fragments = [
        item
        for item in re.findall(r"`([^`]+)`", section)
        if not item.startswith("http")
    ]
    if fragments:
        return fragments[0]
    quoted = re.search(r"“([^”]+)”", section)
    if quoted:
        return quoted.group(1)
    raise SystemExit(f"no excerpt for {case['post_id']}")


def media_items(case: dict) -> list[dict]:
    items = []
    for media in case.get("media_metadata") or []:
        preview = media.get("preview_image_url") or ""
        if not preview and media.get("type") == "photo":
            preview = media.get("url") or ""
        if not preview.startswith("https://pbs.twimg.com/"):
            raise SystemExit(f"{case['post_id']} preview is not a pbs.twimg.com URL")
        play_mp4 = None
        if case["media_type"] == "animated_gif" and media.get("type") == "animated_gif":
            for variant in media.get("variants") or []:
                url = variant.get("url") or ""
                if (
                    variant.get("content_type") == "video/mp4"
                    and url.startswith("https://video.twimg.com/tweet_video/")
                ):
                    play_mp4 = url
                    break
            if not play_mp4:
                raise SystemExit(f"{case['post_id']} GIF has no tweet_video mp4")
        items.append(
            {
                "type": media.get("type"),
                "preview_image_url": preview,
                "width": media.get("width"),
                "height": media.get("height"),
                "play_mp4": play_mp4,
            }
        )
    if not items:
        raise SystemExit(f"{case['post_id']} has no media preview")
    return items


def main() -> None:
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    entries = []
    for case in cases:
        level = case["prompt_level"]
        prompt_text = ""
        if level == "完整":
            prompt_text = prompt_body(ROOT / case["prompt_file"])
        elif level == "节选":
            if case.get("prompt_file"):
                raise SystemExit(f"excerpt should not have a prompt file: {case['post_id']}")
        elif level != "未采集":
            raise SystemExit(f"unknown prompt level: {level}")
        excerpt = excerpt_for(case)
        if level == "节选" and excerpt != EXPECTED_EXCERPTS[case["post_id"]]:
            raise SystemExit(f"excerpt changed for {case['post_id']}: {excerpt!r}")
        if level != "节选" and excerpt:
            raise SystemExit(f"unexpected excerpt on {case['post_id']}")
        if not case["canonical_post_url"].startswith("https://x.com/"):
            raise SystemExit(f"missing X url: {case['post_id']}")
        entries.append(
            {
                "post_id": case["post_id"],
                "title_zh": case["title_zh"],
                "category": case["category"],
                "entry_type": case["entry_type"],
                "media_type": case["media_type"],
                "publisher_name": case["publisher_name"],
                "publisher_handle": case["publisher_handle"],
                "publisher_profile": case["publisher_profile"],
                "publisher_role": case["publisher_role"],
                "canonical_post_url": case["canonical_post_url"],
                "posted_at_utc": case["posted_at_utc"],
                "posted_at_pt": case["posted_at_pt"],
                "prompt_level": level,
                "prompt_status": case["prompt_status"],
                "prompt_file": case.get("prompt_file") or "",
                "prompt_text": prompt_text,
                "excerpt": excerpt,
                "notes_file": case.get("notes_file") or "",
                "editorial_summary_zh": case["editorial_summary_zh"],
                "rights": case["rights"],
                "limits_zh": case["limits_zh"],
                "checked_at_pt": case["checked_at_pt"],
                "media_dimensions": case["media_dimensions"],
                "media": media_items(case),
            }
        )

    gif = [e for e in entries if e["entry_type"] == "gif_case"]
    video = [e for e in entries if e["entry_type"] == "video_workflow"]
    levels = {}
    for entry in entries:
        levels[entry["prompt_level"]] = levels.get(entry["prompt_level"], 0) + 1
    if len(entries) != 43 or len(gif) != 37 or len(video) != 6:
        raise SystemExit(f"unexpected counts: {len(entries)} {len(gif)} {len(video)}")
    if levels != {"未采集": 25, "完整": 15, "节选": 3}:
        raise SystemExit(f"unexpected prompt levels: {levels}")
    if len({e["post_id"] for e in entries}) != 43:
        raise SystemExit("duplicate post ids")
    if any(item["play_mp4"] for entry in video for item in entry["media"]):
        raise SystemExit("video workflows must not expose a playable mp4")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"entries": entries}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(entries)} entries)")


if __name__ == "__main__":
    main()
