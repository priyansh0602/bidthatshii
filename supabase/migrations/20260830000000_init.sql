-- Initial Database Schema Migration for AuctionFigure Platform
-- Phase 0 Scaffolding Setup

-- Version helper function for DB roundtrip health check
CREATE OR REPLACE FUNCTION version()
RETURNS text
LANGUAGE sql
AS $$
  SELECT version();
$$;
