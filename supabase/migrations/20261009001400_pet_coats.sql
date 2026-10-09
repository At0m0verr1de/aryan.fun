-- The pet is a cat now, and the egg it hatches from decides its coat. The old pastel names map onto coats.
alter table public.pets drop constraint pets_colour_check;
update public.pets set colour = case colour
  when 'pink' then 'black' when 'blue' then 'grey' when 'peach' then 'ginger'
  when 'cream' then 'cream' when 'lilac' then 'white' when 'mint' then 'tuxedo' else colour end;
update public.pet_graves set colour = case colour
  when 'pink' then 'black' when 'blue' then 'grey' when 'peach' then 'ginger'
  when 'cream' then 'cream' when 'lilac' then 'white' when 'mint' then 'tuxedo' else colour end;
alter table public.pets add constraint pets_colour_check check (colour in ('black', 'grey', 'ginger', 'cream', 'white', 'tuxedo'));
