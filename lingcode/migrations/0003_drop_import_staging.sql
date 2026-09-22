-- Drop the scaffolding used to stream the VPS dump through the HTTP gateway.
-- The final import ran over a direct Postgres connection from a container-compute
-- job instead, so neither the chunk table nor its reassembly function is needed.

DROP FUNCTION IF EXISTS zz_reassemble(text);

DROP TABLE IF EXISTS zz_import_chunks;
