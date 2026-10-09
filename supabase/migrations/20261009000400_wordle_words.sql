-- Guessed words read from screenshots, the day's answer, and whether the board was checked against it.
-- Same no-spoiler rule as the rest of the row: the other player sees these only after submitting their own.

alter table public.wordle_results
  add column words text[]
    check (words is null or array_to_string(words, ',') ~ '^[A-Z]{5}(,[A-Z]{5}){0,5}$'),
  add column answer text check (answer is null or answer ~ '^[A-Z]{5}$'),
  add column verified boolean not null default false;

-- One word per grid row, and a solved board ends on the answer.
alter table public.wordle_results
  add constraint wordle_results_words_fit_grid
    check (words is null or cardinality(words) = cardinality(grid)),
  add constraint wordle_results_solved_on_answer
    check (words is null or answer is null or not solved or words[cardinality(words)] = answer),
  add constraint wordle_results_verified_has_answer
    check (not verified or answer is not null);
