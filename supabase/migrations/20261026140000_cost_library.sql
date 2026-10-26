-- Cost library for unlisted jobs. Run this after the ZIP seed.
-- Prices here are research ranges. They do not change the rate sheet.

create table if not exists public.cost_library (
  id text primary key,
  name text not null,
  group_key text not null check (group_key in ('handy', 'trades', 'build')),
  unit text not null,
  national_low numeric,
  national_high numeric,
  local_low numeric,
  local_high numeric,
  source text not null default '',
  notes text not null default '',
  keywords text[] not null default '{}',
  performs boolean not null default false,
  sort_order int not null default 0
);

alter table public.cost_library enable row level security;

drop policy if exists cost_library_read on public.cost_library;
create policy cost_library_read on public.cost_library
  for select to authenticated using (true);

drop policy if exists cost_library_write on public.cost_library;
create policy cost_library_write on public.cost_library
  for all to authenticated
  using (public.current_role() = 'owner')
  with check (public.current_role() = 'owner');

grant select, insert, update, delete on public.cost_library to authenticated, service_role;

insert into public.cost_library (
  id, name, group_key, unit, national_low, national_high, local_low, local_high, source, notes, keywords, performs, sort_order
) values
  ('drywall-patch', 'Drywall patch', 'handy', 'per patch', 300, 500, null, null, 'HomeGuide, drywall repair cost', 'Small patches, not a full sheet.', array['drywall patch', 'patch the drywall', 'patch drywall', 'hole in the drywall', 'hole in drywall', 'drywall hole'], true, 1),
  ('drywall-large', 'Drywall, large area', 'handy', 'per sq ft', 3, 8, null, null, 'HomeGuide, drywall repair cost', 'Hang or replace drywall by the square foot.', array['hang drywall', 'drywall', 'sheetrock'], true, 2),
  ('caulking', 'Caulking', 'handy', 'per lin ft', 1.25, 4, null, null, 'HomeAdvisor, cost of caulking', 'Fixture caulk jobs are often a flat visit; this row is per foot.', array['caulk', 'caulking'], true, 3),
  ('interior-door', 'Interior door', 'handy', 'per door', 155, 688, null, null, 'HomeGuide, interior door installation cost', 'Prehung interior door, installed.', array['interior door', 'bedroom door', 'closet door'], true, 4),
  ('lock', 'Lock', 'handy', 'per lock', 75, 200, null, null, 'HomeGuide, door installation cost', 'Lockset or deadbolt swap.', array['deadbolt', 'door knob', 'doorknob', 'lockset', 'lock'], true, 5),
  ('baseboard', 'Baseboard', 'handy', 'per lin ft', 6, 9, null, null, 'HomeGuide, baseboard installation cost', 'Installed baseboard.', array['baseboard', 'base board'], true, 6),
  ('crown', 'Crown molding', 'handy', 'per lin ft', 7, 16, null, null, 'HomeGuide, crown molding cost', 'Installed crown.', array['crown molding', 'crown moulding'], true, 7),
  ('carpentry', 'Minor carpentry repair', 'handy', 'per job', 250, 800, null, null, 'HomeGuide, handyman prices', 'Small wood repairs that are not a deck, roof, or addition.', array['carpentry', 'carpenter', 'wood repair'], true, 8),
  ('shelving', 'Shelving', 'handy', 'per job', 150, 500, null, null, 'HomeGuide, handyman prices', 'Built-in or wall shelves, one job.', array['shelving', 'shelves', 'shelf'], true, 9),
  ('pressure-wash', 'Pressure washing', 'handy', 'per sq ft', 0.08, 0.77, null, null, 'HomeGuide, pressure washing prices', 'Cold wash through hot wash. Whole-house jobs often land around $170 to $360.', array['pressure wash', 'pressure washing', 'power wash', 'power washing'], true, 10),
  ('gutter-cleaning', 'Gutter cleaning', 'handy', 'per lin ft', 0.5, 2.5, null, null, 'HomeGuide, gutter cleaning cost', 'Cleaning only, not new gutters.', array['gutter cleaning', 'clean the gutters', 'gutter clean'], true, 11),
  ('fence-repair', 'Fence repair', 'handy', 'per lin ft', 20, 35, null, null, 'HomeGuide, fence repair cost', 'A typical repair job is often $300 to $900.', array['fence repair', 'repair the fence', 'fix the fence'], true, 12),
  ('deck-repair', 'Deck repair', 'handy', 'per job', 750, 2500, null, null, 'HomeGuide, deck repair cost', 'Typical repair job. Boards, rails, and stairs are components of that job.', array['deck repair', 'repair the deck', 'fix the deck'], true, 13),
  ('flooring', 'Flooring', 'handy', 'per sq ft', 4, 25, null, null, 'HomeGuide, flooring installation cost', 'Through hardwood high. Material and install.', array['hardwood floor', 'laminate floor', 'vinyl plank', 'flooring'], true, 14),
  ('tile', 'Tile', 'handy', 'per sq ft', 10, 50, null, null, 'HomeGuide, tile installation cost', 'Floor or wall tile, installed.', array['backsplash', 'tiling', 'tile'], true, 15),
  ('interior-demo', 'Interior demolition', 'handy', 'per sq ft', 2, 8, null, null, 'HomeGuide, interior demolition cost', 'Non-structural demo.', array['demolition', 'demo the', 'tear out'], true, 16),
  ('electrician-labor', 'Electrician labor', 'trades', 'per hour', 50, 120, null, null, 'HomeGuide, electrician cost', 'Wage-style range, not a customer price. Dropped when a specific electrical job matches.', array['electrician', 'electrical work'], false, 17),
  ('outlet', 'Outlet', 'trades', 'per outlet', 100, 450, null, null, 'HomeGuide, electrician cost', 'Outlet or receptacle, installed.', array['receptacle', 'gfci', 'outlet'], false, 18),
  ('light-fixture', 'Light fixture', 'trades', 'per fixture', 158, 1021, null, null, 'HomeGuide, light fixture installation cost', 'Fixture swap or new fixture.', array['ceiling fan', 'light fixture', 'light switch'], false, 19),
  ('panel-upgrade', 'Electrical panel', 'trades', 'per panel', 1300, 2000, null, null, 'HomeGuide, electrical panel cost', 'Panel upgrade.', array['panel upgrade', 'breaker panel', 'electrical panel', 'service panel', 'rewire'], false, 20),
  ('plumber-labor', 'Plumber labor', 'trades', 'per hour', 45, 200, null, null, 'HomeGuide, plumber cost', 'Wage-style range. Dropped when a specific plumbing job matches.', array['plumber', 'plumbing'], false, 21),
  ('faucet', 'Faucet', 'trades', 'per fixture', 200, 600, null, null, 'HomeGuide, faucet installation cost', 'Installed, including a typical faucet.', array['faucet'], false, 22),
  ('toilet', 'Toilet', 'trades', 'per fixture', 350, 800, null, null, 'HomeGuide, toilet installation cost', 'Installed toilet.', array['toilet'], false, 23),
  ('water-heater', 'Water heater', 'trades', 'per unit', 600, 3100, null, null, 'HomeGuide, water heater installation cost', 'Tank water heater. Tankless runs higher.', array['water heater'], false, 24),
  ('furnace', 'Furnace', 'trades', 'per system', 2823, 10000, null, null, 'HomeGuide, furnace replacement cost', 'Gas furnace high. Propane can run to about $14,200.', array['furnace', 'boiler'], false, 25),
  ('central-ac', 'Central air', 'trades', 'per system', 3887, 8073, null, null, 'HomeGuide, central air cost', 'Central air system.', array['central air', 'air conditioner', 'ac unit'], false, 26),
  ('roof-asphalt', 'Asphalt roof', 'trades', 'per square (100 sq ft)', 300, 600, 320, 750, 'HomeGuide national; Traverse City whole-roof jobs', 'Local high is $750 per square from Traverse City roofs of about 20 to 25 squares at $8,000 to $15,000. Prefer local.', array['shingles', 'shingle', 'roof'], false, 27),
  ('siding', 'Siding, installed', 'build', 'per sq ft', 4, 13, 8.53, 17.48, 'HomeGuide national; Traverse City siding jobs', 'Local from a 2,000 sq ft house: vinyl low about $17,050, LP high about $34,950.', array['siding'], false, 28),
  ('siding-material', 'Siding material only', 'build', 'per sq ft', 4, 12, 5, 18, 'Michigan vinyl through fiber-cement', 'Material, not the installed price.', array['siding material'], false, 29),
  ('new-deck', 'New deck', 'build', 'per sq ft', 25, 80, 45, 100, 'HomeGuide national; local pressure-treated through premium', 'New deck, not a repair.', array['build a deck', 'build the deck', 'new deck'], false, 30),
  ('deck-replacement', 'Deck replacement', 'build', 'per sq ft', 30, 55, 52, 130, 'Traverse City deck jobs', 'Local from a 12 by 16 deck: pressure-treated low about $52 per sq ft, composite high about $130.', array['deck replacement', 'replace the deck', 'replace deck'], false, 31),
  ('replacement-window', 'Replacement window', 'build', 'per window', 450, 1500, 1500, 3500, 'HomeGuide national; local installed window', 'Prefer the local installed range.', array['replacement window', 'replace the window', 'replace windows', 'new windows', 'window replacement'], false, 32),
  ('front-door', 'Front door', 'build', 'per door', 500, 2500, null, null, 'HomeGuide, front door replacement cost', 'Doubles can run to about $6,500.', array['front door', 'entry door', 'exterior door'], false, 33),
  ('room-addition', 'Room addition', 'build', 'per sq ft', 125, 250, null, null, 'HomeGuide, home addition cost', 'Traverse City additions are often $80,000 to $200,000 for a whole job. Do not mix that with this per-foot range.', array['room addition', 'home addition', 'add a room'], false, 34),
  ('bathroom-remodel', 'Bathroom remodel', 'build', 'per job', 3500, 7500, 12000, 55000, 'HomeGuide national; local guest through primary', 'Prefer local.', array['bathroom remodel', 'remodel the bathroom'], false, 35),
  ('kitchen-remodel', 'Kitchen remodel', 'build', 'per job', 15000, 50000, 35000, 90000, 'HomeGuide national; local kitchen jobs', 'Prefer local.', array['kitchen remodel', 'remodel the kitchen'], false, 36),
  ('basement-finish', 'Basement finish', 'build', 'per job', null, null, 40000, 100000, 'Local basement finish jobs', 'No national range on this row. Use the local job range.', array['finish the basement', 'basement finish', 'finish a basement'], false, 37)
on conflict (id) do nothing;
