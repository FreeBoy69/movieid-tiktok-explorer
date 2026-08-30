import asyncio
import sys
import tempfile
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

    def test_search_deduplicates_same_video_id_across_creator_urls(self):
        document = """
        <a href="https://www.tiktok.com/@original/video/7543010097685875998">Original</a>
        <a href="https://www.tiktok.com/@renamed/video/7543010097685875998">Renamed</a>
        """

        with patch.object(
            tiktok_list.requests,
            "get",
            return_value=FakeResponse(document),
            create=True,
        ):
            with patch.object(
                tiktok_list,
                "_fetch_tiktok_oembed_row",
                side_effect=lambda url: tiktok_list._tiktok_oembed_to_row(url),
            ):
                result = tiktok_list._search_via_web_index(
                    "https://www.tiktok.com/search?q=ai%20banana",
                    1,
                )

        self.assertEqual(len(result["videos"]), 1)
        self.assertEqual(result["videos"][0]["authorHandle"], "original")

    def test_extracts_query_specific_discover_terms(self):
        document = """
        <a href="https://www.tiktok.com/discover/ai-banana-fruit">Topic</a>
        <a href="https://www-tiktok-com.translate.goog/discover/nano-banana-ai?_x_tr_tl=en">Translated topic</a>
        """

        self.assertEqual(
            tiktok_list._tiktok_discover_terms_from_search_html(document),
            ["ai banana fruit", "nano banana ai"],
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

    def test_search_cache_preserves_unique_canonical_results(self):
        with tempfile.TemporaryDirectory() as cache_dir:
            with patch.dict("os.environ", {"TIKTOK_SEARCH_CACHE_DIR": cache_dir}):
                tiktok_list._save_tiktok_search_cache(
                    "ai banana",
                    [
                        "https://www.tiktok.com/@first/video/7543010097685875998",
                        "https://www.tiktok.com/@renamed/video/7543010097685875998",
                        "https://www.tiktok.com/@second/video/7577896348595359007",
                    ],
                )
                cached = tiktok_list._load_tiktok_search_cache("ai banana")

        self.assertEqual(
            cached,
            [
                "https://www.tiktok.com/@first/video/7543010097685875998",
                "https://www.tiktok.com/@second/video/7577896348595359007",
            ],
        )

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

    def test_web_index_retries_translated_route_after_rate_limit(self):
        document = '<a href="https://www.tiktok.com/@fallback/video/7543010097685875998">Video</a>'

        with patch.dict("os.environ", {"TIKTOK_WEB_INDEX_RATE_LIMIT_RETRIES": "1"}):
            with patch.object(
                tiktok_list.requests,
                "get",
                side_effect=[
                    FakeResponse("direct rate limited", 429),
                    FakeResponse("translated rate limited", 429),
                    FakeResponse(document),
                ],
                create=True,
            ) as request_get:
                with patch.object(tiktok_list.time, "sleep") as sleep:
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
        self.assertEqual(request_get.call_count, 3)
        sleep.assert_called_once_with(8)

    def test_web_index_paginates_until_requested_count(self):
        first_page = """
        <a href="https://www.tiktok.com/@first/video/7543010097685875998">First</a>
        <a href="https://www.tiktok.com/@second/video/7577896348595359007">Second</a>
        """
        second_page = """
        <a href="https://www.tiktok.com/@third/video/7624548057866177805">Third</a>
        <a href="https://www.tiktok.com/@fourth/video/7635990621211184406">Fourth</a>
        """

        with patch.object(
            tiktok_list.requests,
            "get",
            side_effect=[FakeResponse(first_page), FakeResponse(second_page)],
            create=True,
        ) as request_get:
            with patch.object(
                tiktok_list,
                "_fetch_tiktok_oembed_row",
                side_effect=lambda url: tiktok_list._tiktok_oembed_to_row(url),
            ):
                result = tiktok_list._search_via_web_index(
                    "https://www.tiktok.com/search?q=ai%20banana",
                    4,
                )

        self.assertEqual(len(result["videos"]), 4)
        self.assertEqual(request_get.call_count, 2)
        self.assertEqual(request_get.call_args_list[1].kwargs["params"]["offset"], "1")

    def test_profile_fallback_keeps_only_the_requested_creator(self):
        result = {
            "title": "Search: surprisebox9527",
            "author": "TikTok search",
            "videos": [
                {
                    "id": "one",
                    "author": "GlitchJester",
                    "authorHandle": "surprisebox9527",
                    "playUrl": "https://www.tiktok.com/@surprisebox9527/video/one",
                },
                {
                    "id": "two",
                    "author": "Other creator",
                    "authorHandle": "othercreator",
                    "playUrl": "https://www.tiktok.com/@othercreator/video/two",
                },
                {
                    "id": "three",
                    "author": "GlitchJester",
                    "authorHandle": "",
                    "playUrl": "https://www.tiktok.com/@surprisebox9527/video/three",
                },
            ],
        }

        with patch.object(tiktok_list, "_search_via_web_index", return_value=result) as search:
            recovered = tiktok_list._profile_via_web_index(
                "https://www.tiktok.com/@surprisebox9527",
                10,
            )

        self.assertEqual(recovered["source"], "web-index-profile-fallback")
        self.assertEqual(recovered["title"], "@surprisebox9527")
        self.assertEqual([video["id"] for video in recovered["videos"]], ["one", "three"])
        self.assertIn("q=surprisebox9527", search.call_args.args[0])
        self.assertEqual(search.call_args.kwargs["profile_handle"], "surprisebox9527")

    def test_extracts_profile_identity_from_video_embed_state(self):
        document = """
        <script id="__FRONTITY_CONNECT_STATE__" type="application/json">
        {"source":{"data":{"videoData":{"authorInfos":{
          "secUid":"MS4wLjABAAAA-example",
          "uniqueId":"surprisebox9527",
          "nickname":"GlitchJester"
        }}}}}
        </script>
        """
        with patch.object(
            tiktok_list.requests,
            "get",
            return_value=FakeResponse(document),
            create=True,
        ) as request_get:
            identity = tiktok_list._tiktok_embed_profile_identity(
                "https://www.tiktok.com/@surprisebox9527/video/7508737102532889902"
            )

        self.assertEqual(identity["secUid"], "MS4wLjABAAAA-example")
        self.assertEqual(identity["uniqueId"], "surprisebox9527")
        self.assertEqual(identity["nickname"], "GlitchJester")
        self.assertIn("/embed/v2/7508737102532889902", request_get.call_args.args[0])

    def test_profile_seed_lookup_returns_requested_creators_video(self):
        result = {
            "videos": [
                {
                    "authorHandle": "surprisebox9527",
                    "playUrl": "https://www.tiktok.com/@surprisebox9527/video/7508737102532889902",
                }
            ]
        }
        with patch.object(tiktok_list, "_search_via_web_index", return_value=result) as search:
            seed = tiktok_list._profile_seed_via_web_index(
                "https://www.tiktok.com/@surprisebox9527"
            )

        self.assertEqual(seed, result["videos"][0]["playUrl"])
        self.assertEqual(search.call_args.args[1], 1)
        self.assertEqual(search.call_args.kwargs["profile_handle"], "surprisebox9527")

    def test_full_profile_recovery_discovers_seed_after_direct_failure(self):
        recovered = {"source": "yt-dlp-tiktokuser", "videos": [{"id": "one"}]}
        discovered = "https://www.tiktok.com/@surprisebox9527/video/7508737102532889902"
        with patch.object(
            tiktok_list,
            "_ytdlp_via_profile_page_async",
            side_effect=RuntimeError("mobile profile unavailable"),
        ):
            with patch.object(tiktok_list, "_profile_seed_via_web_index", return_value=discovered):
                with patch.object(
                    tiktok_list,
                    "_ytdlp_via_seed_async",
                    return_value=recovered,
                ) as via_seed:
                    result = asyncio.run(
                        tiktok_list._recover_full_profile_feed_async(
                            "https://www.tiktok.com/@surprisebox9527",
                            1000,
                            "",
                        )
                    )

        self.assertEqual(result, recovered)
        via_seed.assert_awaited_once_with(discovered, 1000)

    def test_profile_page_identity_bypasses_web_index_discovery(self):
        document = """
        <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
        {"userInfo":{"user":{"secUid":"MS4wLjABAAAA-profile","uniqueId":"animefantasyrecap","nickname":"Anime Fantasy"}}}
        </script>
        """
        recovered = {"source": "yt-dlp-tiktokuser-compat", "videos": [{"id": "one"}]}
        with patch.object(
            tiktok_list.requests,
            "get",
            return_value=FakeResponse(document),
            create=True,
        ):
            with patch.object(
                tiktok_list,
                "_ytdlp_videos_via_identity",
                return_value=recovered,
            ) as via_identity:
                result = tiktok_list._ytdlp_videos_via_profile_page(
                    "https://www.tiktok.com/@animefantasyrecap", 50
                )

        self.assertEqual(result, recovered)
        via_identity.assert_called_once()
        self.assertEqual(via_identity.call_args.args[:5], (
            "MS4wLjABAAAA-profile",
            "animefantasyrecap",
            "Anime Fantasy",
            "https://www.tiktok.com/@animefantasyrecap",
            50,
        ))

    def test_profile_listing_uses_isolated_compatibility_ytdlp(self):
        payload = {"_type": "playlist", "entries": [{"id": "7658487491405614350"}]}
        process = types.SimpleNamespace(
            returncode=0,
            stdout=__import__("json").dumps(payload),
            stderr="",
        )
        current_ytdlp = types.SimpleNamespace(YoutubeDL=None)
        with patch.object(tiktok_list, "_profile_ytdlp_compat_dir", return_value="/compat"):
            with patch.object(tiktok_list.os.path, "isdir", return_value=True):
                with patch.object(tiktok_list.subprocess, "run", return_value=process) as run:
                    result, source = tiktok_list._profile_playlist_info(
                        "MS4wLjABAAAA-example",
                        1000,
                        current_ytdlp,
                    )

        self.assertEqual(result, payload)
        self.assertEqual(source, "yt-dlp-tiktokuser-compat")
        self.assertEqual(run.call_args.kwargs["env"]["PYTHONPATH"].split(tiktok_list.os.pathsep)[0], "/compat")
        self.assertIn("1000", run.call_args.args[0])

    def test_profile_index_prefers_a_bounded_duckduckgo_lookup(self):
        document = '<a href="https%3A%2F%2Fwww.tiktok.com%2F%40surprisebox9527%2Fvideo%2F7637890278572969229">Video</a>'

        with patch.object(
            tiktok_list.requests,
            "get",
            return_value=FakeResponse(document),
            create=True,
        ) as request_get:
            with patch.object(
                tiktok_list,
                "_fetch_tiktok_oembed_row",
                side_effect=lambda url: tiktok_list._tiktok_oembed_to_row(url),
            ):
                result = tiktok_list._search_via_web_index(
                    "https://www.tiktok.com/search?q=surprisebox9527",
                    100,
                    profile_handle="surprisebox9527",
                )

        self.assertEqual(result["videos"][0]["authorHandle"], "surprisebox9527")
        self.assertEqual(request_get.call_count, 1)
        self.assertEqual(request_get.call_args.args[0], "https://html.duckduckgo.com/html/")

    def test_profile_fallback_runs_for_any_bare_profile_ytdlp_failure(self):
        profile = "https://www.tiktok.com/@surprisebox9527"

        self.assertTrue(
            tiktok_list._needs_profile_web_index_fallback(
                profile,
                RuntimeError("Unable to extract secondary user ID"),
            )
        )
        self.assertTrue(
            tiktok_list._needs_profile_web_index_fallback(
                profile,
                RuntimeError("HTTP Error 403"),
            )
        )
        self.assertTrue(
            tiktok_list._needs_profile_web_index_fallback(
                profile,
                RuntimeError("Failed to parse JSON"),
            )
        )
        self.assertFalse(
            tiktok_list._needs_profile_web_index_fallback(
                "https://www.tiktok.com/@surprisebox9527/video/7577043911416237325",
                RuntimeError("Unable to extract secondary user ID"),
            )
        )


if __name__ == "__main__":
    unittest.main()
