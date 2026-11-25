-- Crew leads: a yes/no on each worker. A lead can invite people to the crew they are on,
-- see that crew's hours and what those hours pay, and add, change or remove its hours.
-- Run this after the other SQL files. Running it twice is safe. Nobody is a lead until
-- the owner ticks the box, so this changes nothing by itself.

alter table public.workers add column if not exists lead boolean not null default false;
