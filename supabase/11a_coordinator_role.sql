-- NHYIAMU — step 1 of 2: add the Regional coordinator role (run this on its own first)
alter type user_role add value if not exists 'coordinator';
