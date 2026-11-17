-- Run once in the Supabase SQL editor (after supabase-branch-phones.sql). Safe to run again.
-- 1. A branch's city is now always the same as its name (the app no longer has a separate City box).
update public.branches set city = name where city is distinct from name;
-- 2. The separate branch "Phone" is gone: each branch has a Booking Ph. and a Delivery Ph. (the Report prints the
--    Booking Ph.). Keep any old phone by copying it into Booking Ph. where that is still empty.
update public.branches set booking_ph = phone where booking_ph is null and phone is not null;
-- (the old "phone" column is left in place, unused, so nothing can break)
