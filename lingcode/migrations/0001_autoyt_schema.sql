-- AutoYT VPS -> LingCode Cloud: tables, sequences, defaults, RLS policies.
-- Generated: scripts/lingcode-cloud/import-db-function.mjs --emit-ddl
-- auth_users/auth_sessions are LingCode-owned; app_users/app_sessions replace them.

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
ALTER TABLE IF EXISTS ONLY youtube_accounts DROP CONSTRAINT IF EXISTS youtube_accounts_user_id_fkey;
ALTER TABLE IF EXISTS ONLY tracked_youtube_competitors DROP CONSTRAINT IF EXISTS tracked_youtube_competitors_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY tracked_youtube_competitors DROP CONSTRAINT IF EXISTS tracked_youtube_competitors_user_id_fkey;
ALTER TABLE IF EXISTS ONLY saved_tiktok_post_analyses DROP CONSTRAINT IF EXISTS saved_tiktok_post_analyses_user_id_fkey;
ALTER TABLE IF EXISTS ONLY saved_tiktok_playlist_genre_scans DROP CONSTRAINT IF EXISTS saved_tiktok_playlist_genre_scans_user_id_fkey;
ALTER TABLE IF EXISTS ONLY feed_insights DROP CONSTRAINT IF EXISTS feed_insights_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY feed_insights DROP CONSTRAINT IF EXISTS feed_insights_user_id_fkey;
ALTER TABLE IF EXISTS ONLY creator_projects DROP CONSTRAINT IF EXISTS creator_projects_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY creator_projects DROP CONSTRAINT IF EXISTS creator_projects_user_id_fkey;
ALTER TABLE IF EXISTS ONLY creator_projects DROP CONSTRAINT IF EXISTS creator_projects_style_id_fkey;
ALTER TABLE IF EXISTS ONLY creator_project_assets DROP CONSTRAINT IF EXISTS creator_project_assets_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY creator_project_assets DROP CONSTRAINT IF EXISTS creator_project_assets_user_id_fkey;
ALTER TABLE IF EXISTS ONLY creator_project_assets DROP CONSTRAINT IF EXISTS creator_project_assets_project_id_fkey;
ALTER TABLE IF EXISTS ONLY competitor_videos DROP CONSTRAINT IF EXISTS competitor_videos_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY competitor_videos DROP CONSTRAINT IF EXISTS competitor_videos_competitor_id_fkey;
ALTER TABLE IF EXISTS ONLY competitor_channels DROP CONSTRAINT IF EXISTS competitor_channels_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY competitor_channels DROP CONSTRAINT IF EXISTS competitor_channels_user_id_fkey;
ALTER TABLE IF EXISTS ONLY channel_styles DROP CONSTRAINT IF EXISTS channel_styles_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY channel_styles DROP CONSTRAINT IF EXISTS channel_styles_user_id_fkey;
ALTER TABLE IF EXISTS ONLY channel_comment_replies DROP CONSTRAINT IF EXISTS channel_comment_replies_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY channel_comment_replies DROP CONSTRAINT IF EXISTS channel_comment_replies_user_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_uploads DROP CONSTRAINT IF EXISTS automation_uploads_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_uploads DROP CONSTRAINT IF EXISTS automation_uploads_user_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_uploads DROP CONSTRAINT IF EXISTS automation_uploads_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_source_claims DROP CONSTRAINT IF EXISTS automation_source_claims_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_runs DROP CONSTRAINT IF EXISTS automation_runs_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_performance_snapshots DROP CONSTRAINT IF EXISTS automation_performance_snapshots_upload_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_failure_notifications DROP CONSTRAINT IF EXISTS automation_failure_notifications_run_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_failure_notifications DROP CONSTRAINT IF EXISTS automation_failure_notifications_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_comment_replies DROP CONSTRAINT IF EXISTS automation_comment_replies_upload_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_agents DROP CONSTRAINT IF EXISTS automation_agents_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_agents DROP CONSTRAINT IF EXISTS automation_agents_user_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_agent_chats DROP CONSTRAINT IF EXISTS automation_agent_chats_user_id_fkey;
ALTER TABLE IF EXISTS ONLY automation_agent_chats DROP CONSTRAINT IF EXISTS automation_agent_chats_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY app_sessions DROP CONSTRAINT IF EXISTS app_sessions_user_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_niche_observations DROP CONSTRAINT IF EXISTS agent_niche_observations_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_niche_observations DROP CONSTRAINT IF EXISTS agent_niche_observations_user_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_niche_observations DROP CONSTRAINT IF EXISTS agent_niche_observations_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_learning_profiles DROP CONSTRAINT IF EXISTS agent_learning_profiles_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_learning_profiles DROP CONSTRAINT IF EXISTS agent_learning_profiles_user_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_learning_profiles DROP CONSTRAINT IF EXISTS agent_learning_profiles_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_learning_events DROP CONSTRAINT IF EXISTS agent_learning_events_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_learning_events DROP CONSTRAINT IF EXISTS agent_learning_events_user_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_learning_events DROP CONSTRAINT IF EXISTS agent_learning_events_agent_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_content_signals DROP CONSTRAINT IF EXISTS agent_content_signals_youtube_account_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_content_signals DROP CONSTRAINT IF EXISTS agent_content_signals_user_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_content_signals DROP CONSTRAINT IF EXISTS agent_content_signals_upload_id_fkey;
ALTER TABLE IF EXISTS ONLY agent_content_signals DROP CONSTRAINT IF EXISTS agent_content_signals_agent_id_fkey;
DROP INDEX IF EXISTS youtube_accounts_user_idx;
DROP INDEX IF EXISTS tracked_youtube_competitors_account_score_idx;
DROP INDEX IF EXISTS tiktok_comment_cache_expires_idx;
DROP INDEX IF EXISTS saved_tiktok_post_analyses_slug_idx;
DROP INDEX IF EXISTS saved_tiktok_post_analyses_playlist_idx;
DROP INDEX IF EXISTS saved_tiktok_playlists_user_key_idx;
DROP INDEX IF EXISTS saved_tiktok_playlists_user_idx;
DROP INDEX IF EXISTS saved_tiktok_playlists_slug_idx;
DROP INDEX IF EXISTS saved_tiktok_playlists_saved_at_idx;
DROP INDEX IF EXISTS saved_tiktok_playlist_genre_scans_user_idx;
DROP INDEX IF EXISTS niche_library_score_idx;
DROP INDEX IF EXISTS niche_library_macro_idx;
DROP INDEX IF EXISTS movie_identification_cache_youtube_idx;
DROP INDEX IF EXISTS movie_identification_cache_url_idx;
DROP INDEX IF EXISTS movie_identification_cache_tmdb_idx;
DROP INDEX IF EXISTS movie_identification_cache_title_idx;
DROP INDEX IF EXISTS movie_identification_cache_tiktok_idx;
DROP INDEX IF EXISTS movie_identification_cache_mal_idx;
DROP INDEX IF EXISTS movie_identification_cache_file_hash_idx;
DROP INDEX IF EXISTS movie_identification_cache_expires_idx;
DROP INDEX IF EXISTS feed_insights_account_idx;
DROP INDEX IF EXISTS creator_projects_source_idx;
DROP INDEX IF EXISTS creator_projects_account_idx;
DROP INDEX IF EXISTS creator_project_assets_project_idx;
DROP INDEX IF EXISTS competitor_videos_account_velocity_idx;
DROP INDEX IF EXISTS competitor_channels_account_idx;
DROP INDEX IF EXISTS channel_styles_account_idx;
DROP INDEX IF EXISTS channel_comment_replies_video_idx;
DROP INDEX IF EXISTS channel_comment_replies_account_idx;
DROP INDEX IF EXISTS automation_uploads_source_idx;
DROP INDEX IF EXISTS automation_uploads_movie_idx;
DROP INDEX IF EXISTS automation_uploads_agent_idx;
DROP INDEX IF EXISTS automation_source_claims_claimed_idx;
DROP INDEX IF EXISTS automation_snapshots_upload_idx;
DROP INDEX IF EXISTS automation_runs_agent_idx;
DROP INDEX IF EXISTS automation_failure_notifications_pending_idx;
DROP INDEX IF EXISTS automation_comment_replies_upload_idx;
DROP INDEX IF EXISTS automation_agents_user_idx;
DROP INDEX IF EXISTS automation_agents_slug_unique_idx;
DROP INDEX IF EXISTS automation_agents_next_run_idx;
DROP INDEX IF EXISTS automation_agent_chats_agent_idx;
DROP INDEX IF EXISTS auth_sessions_user_idx;
DROP INDEX IF EXISTS auth_sessions_expires_idx;
DROP INDEX IF EXISTS app_sessions_user_idx;
DROP INDEX IF EXISTS app_sessions_expires_idx;
DROP INDEX IF EXISTS agent_niche_observations_score_idx;
DROP INDEX IF EXISTS agent_learning_profiles_channel_idx;
DROP INDEX IF EXISTS agent_learning_events_account_idx;
DROP INDEX IF EXISTS agent_content_signals_msn_idx;
DROP INDEX IF EXISTS agent_content_signals_channel_score_idx;
DROP INDEX IF EXISTS agent_content_signals_agent_score_idx;
ALTER TABLE IF EXISTS ONLY youtube_accounts DROP CONSTRAINT IF EXISTS youtube_accounts_user_id_channel_id_key;
ALTER TABLE IF EXISTS ONLY youtube_accounts DROP CONSTRAINT IF EXISTS youtube_accounts_pkey;
ALTER TABLE IF EXISTS ONLY tracked_youtube_competitors DROP CONSTRAINT IF EXISTS tracked_youtube_competitors_youtube_account_id_channel_id_key;
ALTER TABLE IF EXISTS ONLY tracked_youtube_competitors DROP CONSTRAINT IF EXISTS tracked_youtube_competitors_pkey;
ALTER TABLE IF EXISTS ONLY tiktok_comment_cache DROP CONSTRAINT IF EXISTS tiktok_comment_cache_pkey;
ALTER TABLE IF EXISTS ONLY saved_tiktok_post_analyses DROP CONSTRAINT IF EXISTS saved_tiktok_post_analyses_user_id_post_slug_key;
ALTER TABLE IF EXISTS ONLY saved_tiktok_post_analyses DROP CONSTRAINT IF EXISTS saved_tiktok_post_analyses_pkey;
ALTER TABLE IF EXISTS ONLY saved_tiktok_playlists DROP CONSTRAINT IF EXISTS saved_tiktok_playlists_pkey;
ALTER TABLE IF EXISTS ONLY saved_tiktok_playlist_genre_scans DROP CONSTRAINT IF EXISTS saved_tiktok_playlist_genre_scans_user_id_playlist_key_key;
ALTER TABLE IF EXISTS ONLY saved_tiktok_playlist_genre_scans DROP CONSTRAINT IF EXISTS saved_tiktok_playlist_genre_scans_pkey;
ALTER TABLE IF EXISTS ONLY niche_library DROP CONSTRAINT IF EXISTS niche_library_pkey;
ALTER TABLE IF EXISTS ONLY movie_identification_cache DROP CONSTRAINT IF EXISTS movie_identification_cache_pkey;
ALTER TABLE IF EXISTS ONLY feed_insights DROP CONSTRAINT IF EXISTS feed_insights_pkey;
ALTER TABLE IF EXISTS ONLY creator_projects DROP CONSTRAINT IF EXISTS creator_projects_pkey;
ALTER TABLE IF EXISTS ONLY creator_project_assets DROP CONSTRAINT IF EXISTS creator_project_assets_pkey;
ALTER TABLE IF EXISTS ONLY competitor_videos DROP CONSTRAINT IF EXISTS competitor_videos_pkey;
ALTER TABLE IF EXISTS ONLY competitor_videos DROP CONSTRAINT IF EXISTS competitor_videos_competitor_id_video_id_key;
ALTER TABLE IF EXISTS ONLY competitor_channels DROP CONSTRAINT IF EXISTS competitor_channels_youtube_account_id_channel_url_key;
ALTER TABLE IF EXISTS ONLY competitor_channels DROP CONSTRAINT IF EXISTS competitor_channels_pkey;
ALTER TABLE IF EXISTS ONLY channel_styles DROP CONSTRAINT IF EXISTS channel_styles_pkey;
ALTER TABLE IF EXISTS ONLY channel_comment_replies DROP CONSTRAINT IF EXISTS channel_comment_replies_youtube_account_id_comment_id_key;
ALTER TABLE IF EXISTS ONLY channel_comment_replies DROP CONSTRAINT IF EXISTS channel_comment_replies_pkey;
ALTER TABLE IF EXISTS ONLY automation_uploads DROP CONSTRAINT IF EXISTS automation_uploads_pkey;
ALTER TABLE IF EXISTS ONLY automation_source_claims DROP CONSTRAINT IF EXISTS automation_source_claims_pkey;
ALTER TABLE IF EXISTS ONLY automation_runs DROP CONSTRAINT IF EXISTS automation_runs_pkey;
ALTER TABLE IF EXISTS ONLY automation_performance_snapshots DROP CONSTRAINT IF EXISTS automation_performance_snapshots_pkey;
ALTER TABLE IF EXISTS ONLY automation_failure_notifications DROP CONSTRAINT IF EXISTS automation_failure_notifications_pkey;
ALTER TABLE IF EXISTS ONLY automation_comment_replies DROP CONSTRAINT IF EXISTS automation_comment_replies_upload_id_comment_id_key;
ALTER TABLE IF EXISTS ONLY automation_comment_replies DROP CONSTRAINT IF EXISTS automation_comment_replies_pkey;
ALTER TABLE IF EXISTS ONLY automation_agents DROP CONSTRAINT IF EXISTS automation_agents_pkey;
ALTER TABLE IF EXISTS ONLY automation_agent_chats DROP CONSTRAINT IF EXISTS automation_agent_chats_pkey;
ALTER TABLE IF EXISTS ONLY app_users DROP CONSTRAINT IF EXISTS app_users_pkey;
ALTER TABLE IF EXISTS ONLY app_users DROP CONSTRAINT IF EXISTS app_users_google_sub_key;
ALTER TABLE IF EXISTS ONLY app_sessions DROP CONSTRAINT IF EXISTS app_sessions_pkey;
ALTER TABLE IF EXISTS ONLY agent_niche_observations DROP CONSTRAINT IF EXISTS agent_niche_observations_pkey;
ALTER TABLE IF EXISTS ONLY agent_niche_observations DROP CONSTRAINT IF EXISTS agent_niche_observations_agent_id_micro_niche_key;
ALTER TABLE IF EXISTS ONLY agent_learning_profiles DROP CONSTRAINT IF EXISTS agent_learning_profiles_pkey;
ALTER TABLE IF EXISTS ONLY agent_learning_events DROP CONSTRAINT IF EXISTS agent_learning_events_pkey;
ALTER TABLE IF EXISTS ONLY agent_content_signals DROP CONSTRAINT IF EXISTS agent_content_signals_pkey;
DROP TABLE IF EXISTS youtube_accounts;
DROP TABLE IF EXISTS tracked_youtube_competitors;
DROP TABLE IF EXISTS tiktok_comment_cache;
DROP TABLE IF EXISTS saved_tiktok_post_analyses;
DROP TABLE IF EXISTS saved_tiktok_playlists;
DROP TABLE IF EXISTS saved_tiktok_playlist_genre_scans;
DROP TABLE IF EXISTS niche_library;
DROP TABLE IF EXISTS movie_identification_cache;
DROP TABLE IF EXISTS feed_insights;
DROP TABLE IF EXISTS creator_projects;
DROP TABLE IF EXISTS creator_project_assets;
DROP TABLE IF EXISTS competitor_videos;
DROP TABLE IF EXISTS competitor_channels;
DROP TABLE IF EXISTS channel_styles;
DROP TABLE IF EXISTS channel_comment_replies;
DROP TABLE IF EXISTS automation_uploads;
DROP TABLE IF EXISTS automation_source_claims;
DROP TABLE IF EXISTS automation_runs;
DROP TABLE IF EXISTS automation_performance_snapshots;
DROP TABLE IF EXISTS automation_failure_notifications;
DROP TABLE IF EXISTS automation_comment_replies;
DROP TABLE IF EXISTS automation_agents;
DROP TABLE IF EXISTS automation_agent_chats;
DROP TABLE IF EXISTS app_users;
DROP TABLE IF EXISTS app_sessions;
DROP TABLE IF EXISTS agent_niche_observations;
DROP TABLE IF EXISTS agent_learning_profiles;
DROP TABLE IF EXISTS agent_learning_events;
DROP TABLE IF EXISTS agent_content_signals;
--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



SET default_tablespace = '';
SET default_table_access_method = heap;
--
-- Name: agent_content_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE agent_content_signals (
    upload_id text NOT NULL,
    agent_id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    source_author text DEFAULT ''::text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    source_video_id text DEFAULT ''::text NOT NULL,
    source_views bigint DEFAULT 0 NOT NULL,
    source_likes bigint DEFAULT 0 NOT NULL,
    source_comments bigint DEFAULT 0 NOT NULL,
    genre text DEFAULT ''::text NOT NULL,
    micro_niche text DEFAULT ''::text NOT NULL,
    hook_pattern text DEFAULT ''::text NOT NULL,
    duration_bucket text DEFAULT ''::text NOT NULL,
    publish_hour integer DEFAULT 0 NOT NULL,
    publish_day integer DEFAULT 0 NOT NULL,
    youtube_views bigint DEFAULT 0 NOT NULL,
    youtube_likes bigint DEFAULT 0 NOT NULL,
    youtube_comments bigint DEFAULT 0 NOT NULL,
    score double precision DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: agent_learning_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE agent_learning_events (
    id text NOT NULL,
    agent_id text,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    event_type text DEFAULT 'content_signal'::text NOT NULL,
    source_type text DEFAULT ''::text NOT NULL,
    source_id text DEFAULT ''::text NOT NULL,
    taxonomy jsonb DEFAULT '{}'::jsonb NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    recommendation text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: agent_learning_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE agent_learning_profiles (
    agent_id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    recommendation text DEFAULT ''::text NOT NULL,
    confidence double precision DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    competitor_metadata_style jsonb DEFAULT '{}'::jsonb NOT NULL
);
--
-- Name: agent_niche_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE agent_niche_observations (
    id text NOT NULL,
    agent_id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    micro_niche text NOT NULL,
    macro_niche text DEFAULT ''::text NOT NULL,
    sub_niche text DEFAULT ''::text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    uploads integer DEFAULT 0 NOT NULL,
    total_views bigint DEFAULT 0 NOT NULL,
    best_views bigint DEFAULT 0 NOT NULL,
    confidence double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: app_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE app_sessions (
    id text NOT NULL,
    user_id text NOT NULL,
    active_youtube_account_id text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE app_users (
    id text NOT NULL,
    google_sub text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    avatar_url text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: automation_agent_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_agent_chats (
    id text NOT NULL,
    agent_id text NOT NULL,
    user_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: automation_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_agents (
    id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'paused'::text NOT NULL,
    source_type text DEFAULT 'saved_playlist'::text NOT NULL,
    source_key text DEFAULT ''::text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text DEFAULT ''::text NOT NULL
);
--
-- Name: automation_comment_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_comment_replies (
    id text NOT NULL,
    upload_id text NOT NULL,
    comment_id text NOT NULL,
    reply_id text DEFAULT ''::text NOT NULL,
    reply_text text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: automation_failure_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_failure_notifications (
    run_id text NOT NULL,
    agent_id text NOT NULL,
    recipient text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text DEFAULT ''::text NOT NULL,
    provider_message_id text DEFAULT ''::text NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone
);
--
-- Name: automation_performance_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_performance_snapshots (
    id text NOT NULL,
    upload_id text NOT NULL,
    youtube_video_id text NOT NULL,
    views bigint DEFAULT 0 NOT NULL,
    likes bigint DEFAULT 0 NOT NULL,
    comments bigint DEFAULT 0 NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: automation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_runs (
    id text NOT NULL,
    agent_id text NOT NULL,
    status text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);
--
-- Name: automation_source_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_source_claims (
    agent_id text NOT NULL,
    source_key text NOT NULL,
    run_id text DEFAULT ''::text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: automation_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE automation_uploads (
    id text NOT NULL,
    agent_id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    youtube_video_id text DEFAULT ''::text NOT NULL,
    youtube_url text DEFAULT ''::text NOT NULL,
    source_url text NOT NULL,
    source_video_id text DEFAULT ''::text NOT NULL,
    source_author text DEFAULT ''::text NOT NULL,
    movie_key text DEFAULT ''::text NOT NULL,
    movie_title text DEFAULT ''::text NOT NULL,
    movie_year text DEFAULT ''::text NOT NULL,
    genre text DEFAULT ''::text NOT NULL,
    micro_niche text DEFAULT ''::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    schedule_at timestamp with time zone,
    status text DEFAULT 'uploaded'::text NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: channel_comment_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE channel_comment_replies (
    id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    video_id text DEFAULT ''::text NOT NULL,
    video_title text DEFAULT ''::text NOT NULL,
    comment_id text NOT NULL,
    reply_id text DEFAULT ''::text NOT NULL,
    reply_text text DEFAULT ''::text NOT NULL,
    reply_type text DEFAULT 'ai_engagement'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: channel_styles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE channel_styles (
    id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    source_type text DEFAULT 'youtube'::text NOT NULL,
    source_channel_id text DEFAULT ''::text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    niche text DEFAULT ''::text NOT NULL,
    sub_niche text DEFAULT ''::text NOT NULL,
    micro_niche text DEFAULT ''::text NOT NULL,
    profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: competitor_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE competitor_channels (
    id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    source_type text DEFAULT 'auto'::text NOT NULL,
    channel_title text DEFAULT ''::text NOT NULL,
    channel_url text DEFAULT ''::text NOT NULL,
    channel_handle text DEFAULT ''::text NOT NULL,
    niche text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: competitor_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE competitor_videos (
    id text NOT NULL,
    competitor_id text NOT NULL,
    youtube_account_id text NOT NULL,
    video_id text DEFAULT ''::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    thumbnail_url text DEFAULT ''::text NOT NULL,
    published_at timestamp with time zone,
    view_count bigint DEFAULT 0 NOT NULL,
    like_count bigint DEFAULT 0 NOT NULL,
    comment_count bigint DEFAULT 0 NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    hook_pattern text DEFAULT ''::text NOT NULL,
    niche text DEFAULT ''::text NOT NULL,
    velocity double precision DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: creator_project_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE creator_project_assets (
    id text NOT NULL,
    project_id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    asset_type text DEFAULT ''::text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: creator_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE creator_projects (
    id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    source_type text DEFAULT 'channel_video'::text NOT NULL,
    source_id text DEFAULT ''::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    stage text DEFAULT 'overview'::text NOT NULL,
    style_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    outputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: feed_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE feed_insights (
    id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    type text DEFAULT 'All'::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    action_label text DEFAULT ''::text NOT NULL,
    action_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_type text DEFAULT ''::text NOT NULL,
    source_id text DEFAULT ''::text NOT NULL,
    priority double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed_at timestamp with time zone
);
--
-- Name: movie_identification_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE movie_identification_cache (
    id text NOT NULL,
    source_type text DEFAULT ''::text NOT NULL,
    tiktok_video_id text DEFAULT ''::text NOT NULL,
    youtube_video_id text DEFAULT ''::text NOT NULL,
    normalized_url text DEFAULT ''::text NOT NULL,
    file_hash text DEFAULT ''::text NOT NULL,
    detected_title text DEFAULT ''::text NOT NULL,
    detected_year text DEFAULT ''::text NOT NULL,
    tmdb_id text DEFAULT ''::text NOT NULL,
    tmdb_media_type text DEFAULT ''::text NOT NULL,
    mal_id text DEFAULT ''::text NOT NULL,
    mal_media_type text DEFAULT ''::text NOT NULL,
    confidence double precision DEFAULT 0 NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: niche_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE niche_library (
    id text NOT NULL,
    macro_niche text NOT NULL,
    sub_niche text NOT NULL,
    msn text NOT NULL,
    faceless_formats jsonb DEFAULT '[]'::jsonb NOT NULL,
    target_countries jsonb DEFAULT '[]'::jsonb NOT NULL,
    geo_tier text DEFAULT ''::text NOT NULL,
    cpm_tier text DEFAULT ''::text NOT NULL,
    rpm_range text DEFAULT ''::text NOT NULL,
    competition text DEFAULT ''::text NOT NULL,
    audience_value text DEFAULT ''::text NOT NULL,
    trend_score integer DEFAULT 0 NOT NULL,
    monetization_stack jsonb DEFAULT '[]'::jsonb NOT NULL,
    creator_fit text DEFAULT ''::text NOT NULL,
    acquisition_queries jsonb DEFAULT '[]'::jsonb NOT NULL,
    channel_angles jsonb DEFAULT '[]'::jsonb NOT NULL,
    hook_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
    seed_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    risk_notes text DEFAULT ''::text NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: saved_tiktok_playlist_genre_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE saved_tiktok_playlist_genre_scans (
    id text NOT NULL,
    user_id text NOT NULL,
    playlist_key text NOT NULL,
    playlist_slug text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: saved_tiktok_playlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE saved_tiktok_playlists (
    key text NOT NULL,
    slug text NOT NULL,
    analyzed_url text NOT NULL,
    playlist jsonb NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    user_id text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    auto_tags jsonb DEFAULT '[]'::jsonb NOT NULL
);
--
-- Name: saved_tiktok_post_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE saved_tiktok_post_analyses (
    id text NOT NULL,
    user_id text NOT NULL,
    playlist_key text DEFAULT ''::text NOT NULL,
    post_slug text NOT NULL,
    video jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    auto_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    analyzed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: tiktok_comment_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE tiktok_comment_cache (
    tiktok_video_id text NOT NULL,
    normalized_url text DEFAULT ''::text NOT NULL,
    author_unique_id text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: tracked_youtube_competitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE tracked_youtube_competitors (
    id text NOT NULL,
    user_id text NOT NULL,
    youtube_account_id text NOT NULL,
    channel_id text NOT NULL,
    channel_title text DEFAULT ''::text NOT NULL,
    channel_url text DEFAULT ''::text NOT NULL,
    channel_handle text DEFAULT ''::text NOT NULL,
    thumbnail_url text DEFAULT ''::text NOT NULL,
    niche text DEFAULT ''::text NOT NULL,
    sub_niche text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    recent_videos jsonb DEFAULT '[]'::jsonb NOT NULL,
    score double precision DEFAULT 0 NOT NULL,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
-- Name: youtube_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE youtube_accounts (
    id text NOT NULL,
    user_id text NOT NULL,
    google_sub text NOT NULL,
    email text NOT NULL,
    channel_id text NOT NULL,
    channel_title text NOT NULL,
    channel_handle text DEFAULT ''::text NOT NULL,
    thumbnail_url text DEFAULT ''::text NOT NULL,
    uploads_playlist_id text DEFAULT ''::text NOT NULL,
    access_token text NOT NULL,
    refresh_token text DEFAULT ''::text NOT NULL,
    token_expires_at timestamp with time zone DEFAULT now() NOT NULL,
    scope text DEFAULT ''::text NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    zernio_api_key text,
    zernio_account_id text,
    platform text DEFAULT 'youtube'::text NOT NULL
);
CREATE POLICY app_all ON agent_content_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON agent_learning_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON agent_learning_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON agent_niche_observations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON app_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_agent_chats FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_agents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_comment_replies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_failure_notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_performance_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_source_claims FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON automation_uploads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON channel_comment_replies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON channel_styles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON competitor_channels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON competitor_videos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON creator_project_assets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON creator_projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON feed_insights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON movie_identification_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON niche_library FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON saved_tiktok_playlist_genre_scans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON saved_tiktok_playlists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON saved_tiktok_post_analyses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON tiktok_comment_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON tracked_youtube_competitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY app_all ON youtube_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE TABLE IF NOT EXISTS zz_import_chunks (key text NOT NULL, seq integer NOT NULL, part text NOT NULL, PRIMARY KEY (key, seq));
CREATE POLICY app_all ON zz_import_chunks FOR ALL USING (true) WITH CHECK (true);
