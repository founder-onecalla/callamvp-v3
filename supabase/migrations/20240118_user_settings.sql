-- User Settings Table
-- Stores user preferences for calling behavior, privacy, notifications, and appearance

-- Create enum types
CREATE TYPE caller_mode AS ENUM ('SELF_NAME', 'OTHER_NAME', 'DONT_DISCLOSE');
CREATE TYPE theme_mode AS ENUM ('SYSTEM', 'LIGHT', 'DARK');
CREATE TYPE text_size_mode AS ENUM ('NORMAL', 'LARGE');

-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Profile
  display_name TEXT,

  -- Calling and identity
  default_caller_mode caller_mode DEFAULT 'SELF_NAME',
  default_caller_other_name TEXT,  -- Used when mode is OTHER_NAME
  require_sensitive_confirmation BOOLEAN DEFAULT true,

  -- Privacy and data retention
  transcript_retention_days INTEGER DEFAULT 30,  -- 7, 30, or 0 (forever)

  -- Notifications
  notify_call_completed BOOLEAN DEFAULT false,
  notify_call_failed BOOLEAN DEFAULT true,

  -- Appearance
  theme theme_mode DEFAULT 'SYSTEM',
  text_size text_size_mode DEFAULT 'NORMAL',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add check constraint for retention days
ALTER TABLE user_settings ADD CONSTRAINT valid_retention_days
  CHECK (transcript_retention_days IN (0, 7, 30));

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own settings
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to auto-create settings row on first access
CREATE OR REPLACE FUNCTION ensure_user_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create settings when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created_settings ON auth.users;
CREATE TRIGGER on_auth_user_created_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION ensure_user_settings();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp
CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_timestamp();

-- Create settings for existing users
INSERT INTO user_settings (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Comments
COMMENT ON TABLE user_settings IS 'User preferences for calling, privacy, notifications, and appearance';
COMMENT ON COLUMN user_settings.default_caller_mode IS 'How to identify caller: SELF_NAME (use display_name), OTHER_NAME (use default_caller_other_name), DONT_DISCLOSE (only if asked)';
COMMENT ON COLUMN user_settings.transcript_retention_days IS 'Days to keep transcripts: 7, 30, or 0 for forever';
