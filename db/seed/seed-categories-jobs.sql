-- Phase 1 seed: categories (PLAN.md §6b) and jobs-to-be-done (PLAN.md §1.1).
-- Small and stable enough to hand-author directly, unlike the ritual seed
-- (see scripts/seed-rituals.mjs -> db/seed/seed-rituals.sql).

INSERT INTO categories (name, slug, color, icon, description, sort_order) VALUES
  ('Learning & Craft', 'learning-craft', '#2563EB', 'graduation-cap', 'Raising the quality bar — critique, review, and deliberate practice.', 1),
  ('Research & Customer Exposure', 'research-customer-exposure', '#0D9488', 'search', 'Staying close to the people you build for.', 2),
  ('Innovation & Exploration', 'innovation-exploration', '#7C3AED', 'lightbulb', 'New tech, new methods, and the space to try things.', 3),
  ('Alignment & Operations', 'alignment-operations', '#D97706', 'compass', 'Staying coordinated — plans, decisions, and status everyone can see.', 4),
  ('Showcase & Storytelling', 'showcase-storytelling', '#DB2777', 'megaphone', 'Making work visible, inside and out.', 5),
  ('Decision Making', 'decision-making', '#4F46E5', 'split', 'How choices get made, recorded, and revisited.', 6),
  ('People & Culture', 'people-culture', '#16A34A', 'heart-handshake', 'Belonging, recognition, and growth.', 7),
  ('Reflection & Renewal', 'reflection-renewal', '#0891B2', 'refresh-ccw', 'Retros, resets, and taking stock.', 8),
  ('Outside Voices', 'outside-voices', '#DC2626', 'mic', 'Guests, customers, and other disciplines in the room.', 9);

INSERT INTO jobs (slug, name, description, icon, sort_order, typical_span) VALUES
  ('raise-craft', 'Raise the quality of our craft', 'Sharpen the work itself — critique, review, deliberate practice.', 'sparkles', 1, 'ongoing'),
  ('get-aligned', 'Get aligned / cut the chaos', 'Fewer surprises, clearer status, shared understanding of the plan.', 'compass', 2, 'ongoing'),
  ('learn-faster', 'Learn faster, build skills', 'Grow the team''s capability on purpose, not by accident.', 'graduation-cap', 3, 'ongoing'),
  ('better-decisions', 'Make better decisions', 'Decide faster, with less rework and clearer ownership.', 'split', 4, 'ongoing'),
  ('closer-to-customers', 'Get closer to our customers', 'Keep real user contact in the team''s regular rhythm.', 'users', 5, 'ongoing'),
  ('build-cohesion', 'Build cohesion and belonging', 'A team that trusts each other and wants to stay.', 'heart-handshake', 6, 'ongoing'),
  ('onboard-well', 'Onboard new people well', 'New hires productive and connected fast.', 'door-open', 7, 'bounded'),
  ('explore-new-tech', 'Explore new tech / AI', 'Deliberate space to try new tools and techniques.', 'cpu', 8, 'ongoing'),
  ('make-work-visible', 'Make our work visible', 'Stakeholders and the wider org see what the team is doing.', 'megaphone', 9, 'ongoing'),
  ('run-research-study', 'Run a research study', 'A focused, time-boxed push to learn something specific.', 'search', 10, 'bounded'),
  ('ship-launch-well', 'Ship a launch well', 'Coordinated, low-drama releases with a clear retro loop.', 'rocket', 11, 'bounded'),
  ('reset-after-hard-stretch', 'Reset after a hard stretch', 'Recover deliberately after a crunch, instead of just moving on.', 'refresh-ccw', 12, 'one-off');
