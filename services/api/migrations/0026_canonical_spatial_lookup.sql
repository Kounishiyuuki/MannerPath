-- DATA DB: published coverage and canonical geographic candidate lookups only.
CREATE INDEX idx_spots_latitude_longitude ON spots(latitude, longitude);
