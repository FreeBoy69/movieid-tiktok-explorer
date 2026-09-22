-- AutoYT VPS -> LingCode Cloud: indexes, primary keys, foreign keys.
-- Apply AFTER the data import.

--
-- Name: agent_content_signals agent_content_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_content_signals
    ADD CONSTRAINT agent_content_signals_pkey PRIMARY KEY (upload_id);
--
-- Name: agent_learning_events agent_learning_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_events
    ADD CONSTRAINT agent_learning_events_pkey PRIMARY KEY (id);
--
-- Name: agent_learning_profiles agent_learning_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_profiles
    ADD CONSTRAINT agent_learning_profiles_pkey PRIMARY KEY (agent_id);
--
-- Name: agent_niche_observations agent_niche_observations_agent_id_micro_niche_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_niche_observations
    ADD CONSTRAINT agent_niche_observations_agent_id_micro_niche_key UNIQUE (agent_id, micro_niche);
--
-- Name: agent_niche_observations agent_niche_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_niche_observations
    ADD CONSTRAINT agent_niche_observations_pkey PRIMARY KEY (id);
--
-- Name: app_sessions app_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY app_sessions
    ADD CONSTRAINT app_sessions_pkey PRIMARY KEY (id);
--
-- Name: app_users app_users_google_sub_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY app_users
    ADD CONSTRAINT app_users_google_sub_key UNIQUE (google_sub);
--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);
--
-- Name: automation_agent_chats automation_agent_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_agent_chats
    ADD CONSTRAINT automation_agent_chats_pkey PRIMARY KEY (id);
--
-- Name: automation_agents automation_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_agents
    ADD CONSTRAINT automation_agents_pkey PRIMARY KEY (id);
--
-- Name: automation_comment_replies automation_comment_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_comment_replies
    ADD CONSTRAINT automation_comment_replies_pkey PRIMARY KEY (id);
--
-- Name: automation_comment_replies automation_comment_replies_upload_id_comment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_comment_replies
    ADD CONSTRAINT automation_comment_replies_upload_id_comment_id_key UNIQUE (upload_id, comment_id);
--
-- Name: automation_failure_notifications automation_failure_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_failure_notifications
    ADD CONSTRAINT automation_failure_notifications_pkey PRIMARY KEY (run_id);
--
-- Name: automation_performance_snapshots automation_performance_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_performance_snapshots
    ADD CONSTRAINT automation_performance_snapshots_pkey PRIMARY KEY (id);
--
-- Name: automation_runs automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_runs
    ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);
--
-- Name: automation_source_claims automation_source_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_source_claims
    ADD CONSTRAINT automation_source_claims_pkey PRIMARY KEY (agent_id, source_key);
--
-- Name: automation_uploads automation_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_uploads
    ADD CONSTRAINT automation_uploads_pkey PRIMARY KEY (id);
--
-- Name: channel_comment_replies channel_comment_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_comment_replies
    ADD CONSTRAINT channel_comment_replies_pkey PRIMARY KEY (id);
--
-- Name: channel_comment_replies channel_comment_replies_youtube_account_id_comment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_comment_replies
    ADD CONSTRAINT channel_comment_replies_youtube_account_id_comment_id_key UNIQUE (youtube_account_id, comment_id);
--
-- Name: channel_styles channel_styles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_styles
    ADD CONSTRAINT channel_styles_pkey PRIMARY KEY (id);
--
-- Name: competitor_channels competitor_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_channels
    ADD CONSTRAINT competitor_channels_pkey PRIMARY KEY (id);
--
-- Name: competitor_channels competitor_channels_youtube_account_id_channel_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_channels
    ADD CONSTRAINT competitor_channels_youtube_account_id_channel_url_key UNIQUE (youtube_account_id, channel_url);
--
-- Name: competitor_videos competitor_videos_competitor_id_video_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_videos
    ADD CONSTRAINT competitor_videos_competitor_id_video_id_key UNIQUE (competitor_id, video_id);
--
-- Name: competitor_videos competitor_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_videos
    ADD CONSTRAINT competitor_videos_pkey PRIMARY KEY (id);
--
-- Name: creator_project_assets creator_project_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_project_assets
    ADD CONSTRAINT creator_project_assets_pkey PRIMARY KEY (id);
--
-- Name: creator_projects creator_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_projects
    ADD CONSTRAINT creator_projects_pkey PRIMARY KEY (id);
--
-- Name: feed_insights feed_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY feed_insights
    ADD CONSTRAINT feed_insights_pkey PRIMARY KEY (id);
--
-- Name: movie_identification_cache movie_identification_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY movie_identification_cache
    ADD CONSTRAINT movie_identification_cache_pkey PRIMARY KEY (id);
--
-- Name: niche_library niche_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY niche_library
    ADD CONSTRAINT niche_library_pkey PRIMARY KEY (id);
--
-- Name: saved_tiktok_playlist_genre_scans saved_tiktok_playlist_genre_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY saved_tiktok_playlist_genre_scans
    ADD CONSTRAINT saved_tiktok_playlist_genre_scans_pkey PRIMARY KEY (id);
--
-- Name: saved_tiktok_playlist_genre_scans saved_tiktok_playlist_genre_scans_user_id_playlist_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY saved_tiktok_playlist_genre_scans
    ADD CONSTRAINT saved_tiktok_playlist_genre_scans_user_id_playlist_key_key UNIQUE (user_id, playlist_key);
--
-- Name: saved_tiktok_playlists saved_tiktok_playlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY saved_tiktok_playlists
    ADD CONSTRAINT saved_tiktok_playlists_pkey PRIMARY KEY (id);
--
-- Name: saved_tiktok_post_analyses saved_tiktok_post_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY saved_tiktok_post_analyses
    ADD CONSTRAINT saved_tiktok_post_analyses_pkey PRIMARY KEY (id);
--
-- Name: saved_tiktok_post_analyses saved_tiktok_post_analyses_user_id_post_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY saved_tiktok_post_analyses
    ADD CONSTRAINT saved_tiktok_post_analyses_user_id_post_slug_key UNIQUE (user_id, post_slug);
--
-- Name: tiktok_comment_cache tiktok_comment_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tiktok_comment_cache
    ADD CONSTRAINT tiktok_comment_cache_pkey PRIMARY KEY (tiktok_video_id);
--
-- Name: tracked_youtube_competitors tracked_youtube_competitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tracked_youtube_competitors
    ADD CONSTRAINT tracked_youtube_competitors_pkey PRIMARY KEY (id);
--
-- Name: tracked_youtube_competitors tracked_youtube_competitors_youtube_account_id_channel_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tracked_youtube_competitors
    ADD CONSTRAINT tracked_youtube_competitors_youtube_account_id_channel_id_key UNIQUE (youtube_account_id, channel_id);
--
-- Name: youtube_accounts youtube_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY youtube_accounts
    ADD CONSTRAINT youtube_accounts_pkey PRIMARY KEY (id);
--
-- Name: youtube_accounts youtube_accounts_user_id_channel_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY youtube_accounts
    ADD CONSTRAINT youtube_accounts_user_id_channel_id_key UNIQUE (user_id, channel_id);
--
-- Name: agent_content_signals_agent_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_content_signals_agent_score_idx ON agent_content_signals USING btree (agent_id, score DESC);
--
-- Name: agent_content_signals_channel_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_content_signals_channel_score_idx ON agent_content_signals USING btree (youtube_account_id, score DESC);
--
-- Name: agent_content_signals_msn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_content_signals_msn_idx ON agent_content_signals USING btree (micro_niche);
--
-- Name: agent_learning_events_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_learning_events_account_idx ON agent_learning_events USING btree (youtube_account_id, created_at DESC);
--
-- Name: agent_learning_profiles_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_learning_profiles_channel_idx ON agent_learning_profiles USING btree (youtube_account_id, updated_at DESC);
--
-- Name: agent_niche_observations_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_niche_observations_score_idx ON agent_niche_observations USING btree (total_views DESC, confidence DESC);
--
-- Name: app_sessions_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_sessions_expires_idx ON app_sessions USING btree (expires_at);
--
-- Name: app_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_sessions_user_idx ON app_sessions USING btree (user_id);
--
-- Name: automation_agent_chats_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_agent_chats_agent_idx ON automation_agent_chats USING btree (agent_id, updated_at DESC);
--
-- Name: automation_agents_next_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_agents_next_run_idx ON automation_agents USING btree (status, next_run_at);
--
-- Name: automation_agents_slug_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_agents_slug_unique_idx ON automation_agents USING btree (slug) WHERE (slug <> ''::text);
--
-- Name: automation_agents_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_agents_user_idx ON automation_agents USING btree (user_id);
--
-- Name: automation_comment_replies_upload_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_comment_replies_upload_idx ON automation_comment_replies USING btree (upload_id, created_at DESC);
--
-- Name: automation_failure_notifications_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_failure_notifications_pending_idx ON automation_failure_notifications USING btree (status, next_attempt_at);
--
-- Name: automation_runs_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_agent_idx ON automation_runs USING btree (agent_id, started_at DESC);
--
-- Name: automation_snapshots_upload_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_snapshots_upload_idx ON automation_performance_snapshots USING btree (upload_id, captured_at DESC);
--
-- Name: automation_source_claims_claimed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_source_claims_claimed_idx ON automation_source_claims USING btree (claimed_at DESC);
--
-- Name: automation_uploads_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_uploads_agent_idx ON automation_uploads USING btree (agent_id, created_at DESC);
--
-- Name: automation_uploads_movie_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_uploads_movie_idx ON automation_uploads USING btree (youtube_account_id, movie_key);
--
-- Name: automation_uploads_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_uploads_source_idx ON automation_uploads USING btree (agent_id, source_video_id);
--
-- Name: channel_comment_replies_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_comment_replies_account_idx ON channel_comment_replies USING btree (youtube_account_id, created_at DESC);
--
-- Name: channel_comment_replies_video_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_comment_replies_video_idx ON channel_comment_replies USING btree (video_id, created_at DESC);
--
-- Name: channel_styles_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_styles_account_idx ON channel_styles USING btree (youtube_account_id, updated_at DESC);
--
-- Name: competitor_channels_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX competitor_channels_account_idx ON competitor_channels USING btree (youtube_account_id, updated_at DESC);
--
-- Name: competitor_videos_account_velocity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX competitor_videos_account_velocity_idx ON competitor_videos USING btree (youtube_account_id, velocity DESC);
--
-- Name: creator_project_assets_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX creator_project_assets_project_idx ON creator_project_assets USING btree (project_id, created_at DESC);
--
-- Name: creator_projects_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX creator_projects_account_idx ON creator_projects USING btree (youtube_account_id, updated_at DESC);
--
-- Name: creator_projects_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX creator_projects_source_idx ON creator_projects USING btree (youtube_account_id, source_type, source_id);
--
-- Name: feed_insights_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_insights_account_idx ON feed_insights USING btree (youtube_account_id, status, priority DESC, updated_at DESC);
--
-- Name: movie_identification_cache_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movie_identification_cache_expires_idx ON movie_identification_cache USING btree (expires_at);
--
-- Name: movie_identification_cache_file_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX movie_identification_cache_file_hash_idx ON movie_identification_cache USING btree (file_hash) WHERE (file_hash <> ''::text);
--
-- Name: movie_identification_cache_mal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movie_identification_cache_mal_idx ON movie_identification_cache USING btree (mal_id, mal_media_type);
--
-- Name: movie_identification_cache_tiktok_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX movie_identification_cache_tiktok_idx ON movie_identification_cache USING btree (tiktok_video_id) WHERE (tiktok_video_id <> ''::text);
--
-- Name: movie_identification_cache_title_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movie_identification_cache_title_idx ON movie_identification_cache USING btree (lower(detected_title), detected_year);
--
-- Name: movie_identification_cache_tmdb_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movie_identification_cache_tmdb_idx ON movie_identification_cache USING btree (tmdb_id, tmdb_media_type);
--
-- Name: movie_identification_cache_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX movie_identification_cache_url_idx ON movie_identification_cache USING btree (normalized_url) WHERE (normalized_url <> ''::text);
--
-- Name: movie_identification_cache_youtube_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX movie_identification_cache_youtube_idx ON movie_identification_cache USING btree (youtube_video_id) WHERE (youtube_video_id <> ''::text);
--
-- Name: niche_library_macro_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX niche_library_macro_idx ON niche_library USING btree (macro_niche);
--
-- Name: niche_library_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX niche_library_score_idx ON niche_library USING btree (trend_score DESC);
--
-- Name: saved_tiktok_playlist_genre_scans_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_tiktok_playlist_genre_scans_user_idx ON saved_tiktok_playlist_genre_scans USING btree (user_id, updated_at DESC);
--
-- Name: saved_tiktok_playlists_saved_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_tiktok_playlists_saved_at_idx ON saved_tiktok_playlists USING btree (saved_at DESC);
--
-- Name: saved_tiktok_playlists_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_tiktok_playlists_slug_idx ON saved_tiktok_playlists USING btree (slug);
--
-- Name: saved_tiktok_playlists_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_tiktok_playlists_user_idx ON saved_tiktok_playlists USING btree (user_id, saved_at DESC);
--
-- Name: saved_tiktok_playlists_user_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX saved_tiktok_playlists_user_key_idx ON saved_tiktok_playlists USING btree (user_id, key) WHERE (COALESCE(user_id, ''::text) <> ''::text);
--
-- Name: saved_tiktok_post_analyses_playlist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_tiktok_post_analyses_playlist_idx ON saved_tiktok_post_analyses USING btree (user_id, playlist_key, analyzed_at DESC);
--
-- Name: saved_tiktok_post_analyses_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_tiktok_post_analyses_slug_idx ON saved_tiktok_post_analyses USING btree (user_id, post_slug);
--
-- Name: tiktok_comment_cache_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tiktok_comment_cache_expires_idx ON tiktok_comment_cache USING btree (expires_at);
--
-- Name: tracked_youtube_competitors_account_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tracked_youtube_competitors_account_score_idx ON tracked_youtube_competitors USING btree (youtube_account_id, score DESC);
--
-- Name: youtube_accounts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX youtube_accounts_user_idx ON youtube_accounts USING btree (user_id);
--
-- Name: agent_content_signals agent_content_signals_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_content_signals
    ADD CONSTRAINT agent_content_signals_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: agent_content_signals agent_content_signals_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_content_signals
    ADD CONSTRAINT agent_content_signals_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES automation_uploads(id) ON DELETE CASCADE;
--
-- Name: agent_content_signals agent_content_signals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_content_signals
    ADD CONSTRAINT agent_content_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: agent_content_signals agent_content_signals_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_content_signals
    ADD CONSTRAINT agent_content_signals_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: agent_learning_events agent_learning_events_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_events
    ADD CONSTRAINT agent_learning_events_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: agent_learning_events agent_learning_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_events
    ADD CONSTRAINT agent_learning_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: agent_learning_events agent_learning_events_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_events
    ADD CONSTRAINT agent_learning_events_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: agent_learning_profiles agent_learning_profiles_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_profiles
    ADD CONSTRAINT agent_learning_profiles_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: agent_learning_profiles agent_learning_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_profiles
    ADD CONSTRAINT agent_learning_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: agent_learning_profiles agent_learning_profiles_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_learning_profiles
    ADD CONSTRAINT agent_learning_profiles_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: agent_niche_observations agent_niche_observations_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_niche_observations
    ADD CONSTRAINT agent_niche_observations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: agent_niche_observations agent_niche_observations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_niche_observations
    ADD CONSTRAINT agent_niche_observations_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: agent_niche_observations agent_niche_observations_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_niche_observations
    ADD CONSTRAINT agent_niche_observations_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: app_sessions app_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY app_sessions
    ADD CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- auth_sessions/auth_users are intentionally absent from this schema. On the VPS they
-- were stale duplicates whose rows were a strict subset of app_sessions/app_users, so
-- they were dropped during the migration and their FK constraint is not recreated.
--
--
-- Name: automation_agent_chats automation_agent_chats_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_agent_chats
    ADD CONSTRAINT automation_agent_chats_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: automation_agent_chats automation_agent_chats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_agent_chats
    ADD CONSTRAINT automation_agent_chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: automation_agents automation_agents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_agents
    ADD CONSTRAINT automation_agents_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: automation_agents automation_agents_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_agents
    ADD CONSTRAINT automation_agents_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: automation_comment_replies automation_comment_replies_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_comment_replies
    ADD CONSTRAINT automation_comment_replies_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES automation_uploads(id) ON DELETE CASCADE;
--
-- Name: automation_failure_notifications automation_failure_notifications_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_failure_notifications
    ADD CONSTRAINT automation_failure_notifications_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: automation_failure_notifications automation_failure_notifications_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_failure_notifications
    ADD CONSTRAINT automation_failure_notifications_run_id_fkey FOREIGN KEY (run_id) REFERENCES automation_runs(id) ON DELETE CASCADE;
--
-- Name: automation_performance_snapshots automation_performance_snapshots_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_performance_snapshots
    ADD CONSTRAINT automation_performance_snapshots_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES automation_uploads(id) ON DELETE CASCADE;
--
-- Name: automation_runs automation_runs_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_runs
    ADD CONSTRAINT automation_runs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: automation_source_claims automation_source_claims_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_source_claims
    ADD CONSTRAINT automation_source_claims_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: automation_uploads automation_uploads_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_uploads
    ADD CONSTRAINT automation_uploads_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES automation_agents(id) ON DELETE CASCADE;
--
-- Name: automation_uploads automation_uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_uploads
    ADD CONSTRAINT automation_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: automation_uploads automation_uploads_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY automation_uploads
    ADD CONSTRAINT automation_uploads_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: channel_comment_replies channel_comment_replies_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_comment_replies
    ADD CONSTRAINT channel_comment_replies_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: channel_comment_replies channel_comment_replies_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_comment_replies
    ADD CONSTRAINT channel_comment_replies_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: channel_styles channel_styles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_styles
    ADD CONSTRAINT channel_styles_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: channel_styles channel_styles_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_styles
    ADD CONSTRAINT channel_styles_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: competitor_channels competitor_channels_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_channels
    ADD CONSTRAINT competitor_channels_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: competitor_channels competitor_channels_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_channels
    ADD CONSTRAINT competitor_channels_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: competitor_videos competitor_videos_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_videos
    ADD CONSTRAINT competitor_videos_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES competitor_channels(id) ON DELETE CASCADE;
--
-- Name: competitor_videos competitor_videos_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY competitor_videos
    ADD CONSTRAINT competitor_videos_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: creator_project_assets creator_project_assets_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_project_assets
    ADD CONSTRAINT creator_project_assets_project_id_fkey FOREIGN KEY (project_id) REFERENCES creator_projects(id) ON DELETE CASCADE;
--
-- Name: creator_project_assets creator_project_assets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_project_assets
    ADD CONSTRAINT creator_project_assets_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: creator_project_assets creator_project_assets_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_project_assets
    ADD CONSTRAINT creator_project_assets_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: creator_projects creator_projects_style_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_projects
    ADD CONSTRAINT creator_projects_style_id_fkey FOREIGN KEY (style_id) REFERENCES channel_styles(id) ON DELETE SET NULL;
--
-- Name: creator_projects creator_projects_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_projects
    ADD CONSTRAINT creator_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: creator_projects creator_projects_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY creator_projects
    ADD CONSTRAINT creator_projects_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: feed_insights feed_insights_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY feed_insights
    ADD CONSTRAINT feed_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: feed_insights feed_insights_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY feed_insights
    ADD CONSTRAINT feed_insights_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: saved_tiktok_playlist_genre_scans saved_tiktok_playlist_genre_scans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY saved_tiktok_playlist_genre_scans
    ADD CONSTRAINT saved_tiktok_playlist_genre_scans_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: saved_tiktok_post_analyses saved_tiktok_post_analyses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY saved_tiktok_post_analyses
    ADD CONSTRAINT saved_tiktok_post_analyses_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: tracked_youtube_competitors tracked_youtube_competitors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tracked_youtube_competitors
    ADD CONSTRAINT tracked_youtube_competitors_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- Name: tracked_youtube_competitors tracked_youtube_competitors_youtube_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tracked_youtube_competitors
    ADD CONSTRAINT tracked_youtube_competitors_youtube_account_id_fkey FOREIGN KEY (youtube_account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE;
--
-- Name: youtube_accounts youtube_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY youtube_accounts
    ADD CONSTRAINT youtube_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
--
-- PostgreSQL database dump complete
--


