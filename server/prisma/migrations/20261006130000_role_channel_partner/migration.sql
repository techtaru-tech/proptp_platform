-- The agent role is a channel partner. Existing rows keep their value under the new name.
ALTER TYPE "UserRole" RENAME VALUE 'agent' TO 'channel_partner';
