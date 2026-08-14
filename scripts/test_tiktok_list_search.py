import sys
import types
import unittest
from unittest.mock import patch


try:
    import requests  # noqa: F401
except ModuleNotFoundError:
    requests_stub = types.ModuleType("requests")
    requests_stub.Response = object
    requests_stub.RequestException = RuntimeError
    sys.modules["requests"] = requests_stub

from scripts import tiktok_list


class FakeResponse:
    def __init__(self, text: str, status_code: int = 200):
        self.text = text
        self.status_code = status_code


class TikTokSearchFallbackTests(unittest.TestCase):
    def test_extracts_and_deduplicates_canonical_video_urls(self):
        document = """
        <a href="https://www.tiktok.com/@first.creator/video/7543010097685875998?lang=en">First</a>
        <a href="https%3A%2F%2Fwww.tiktok.com%2F%40first.creator%2Fvideo%2F7543010097685875998">Duplicate</a>
        {"url":"https:\/\/www.tiktok.com\/@second_creator\/video\/7577896348595359007"}
        """

        self.assertEqual(
            tiktok_list._tiktok_video_urls_from_search_html(document),
            [
                "https://www.tiktok.com/@first.creator/video/7543010097685875998",
                "https://www.tiktok.com/@second_creator/video/7577896348595359007",
            ],
        )

    def test_maps_oembed_metadata_to_compilation_card(self):
        row = tiktok_list._tiktok_oembed_to_row(
            "https://www.tiktok.com/@carterpcs/video/7577896348595359007",
            {
                "title": "AI images just got better",
                "author_name": "Carterpcs",
                "author_url": "https://www.tiktok.com/@carterpcs",
                "thumbnail_url": "https://example.com/cover.jpg",
                "thumbnail_width": 720,
                "thumbnail_height": 1280,
            },
        )

        self.assertEqual(row["id"], "7577896348595359007")
        self.assertEqual(row["authorHandle"], "carterpcs")
        self.assertEqual(row["title"], "AI images just got better")
        self.assertEqual(row["dynamicCover"], "https://example.com/cover.jpg")
        self.assertEqual((row["width"], row["height"]), (720, 1280))
        self.assertGreater(row["createdAt"], 0)

    def test_web_index_search_hydrates_discovered_links(self):
        document = """
        <a href="https://www.tiktok.com/@first/video/7543010097685875998">First</a>
        <a href="https://www.tiktok.com/@second/video/7577896348595359007">Second</a>
        """

        def hydrate(url: str):
            return tiktok_list._tiktok_oembed_to_row(url, {"title": url.rsplit("/", 1)[-1]})

        with patch.object(tiktok_list.requests, "get", return_value=FakeResponse(document), create=True) as request_get:
            with patch.object(tiktok_list, "_fetch_tiktok_oembed_row", side_effect=hydrate):
                result = tiktok_list._search_via_web_index(
                    "https://www.tiktok.com/search?q=ai%20banana",
                    2,
                )

        self.assertEqual(result["source"], "web-index-tiktok-oembed")
        self.assertEqual(len(result["videos"]), 2)
        self.assertEqual(result["videos"][0]["authorHandle"], "first")
        request_get.assert_called_once()

    def test_web_index_uses_translated_route_after_direct_rate_limit(self):
        document = '<a href="https://www.tiktok.com/@fallback/video/7543010097685875998">Video</a>'

        with patch.object(
            tiktok_list.requests,
            "get",
            side_effect=[FakeResponse("rate limited", 429), FakeResponse(document)],
            create=True,
        ) as request_get:
            with patch.object(
                tiktok_list,
                "_fetch_tiktok_oembed_row",
                side_effect=lambda url: tiktok_list._tiktok_oembed_to_row(url),
            ):
                result = tiktok_list._search_via_web_index(
                    "https://www.tiktok.com/search?q=ai%20banana",
                    1,
                )

        self.assertEqual(result["videos"][0]["authorHandle"], "fallback")
        self.assertEqual(request_get.call_count, 2)


if __name__ == "__main__":
    unittest.main()
