-- NHYIAMU — use the live Paystack key (Vault secret "paystack_live") when it exists; otherwise the test key ("paystack_secret")
create or replace function paystack_verify(p_ref text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_res record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_live' limit 1;
  if v_secret is null then
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret' limit 1;
  end if;
  if v_secret is null then raise exception 'Online payments are not set up yet (missing Paystack key)'; end if;
  select status, content into v_res from extensions.http((
    'GET', 'https://api.paystack.co/transaction/verify/' || p_ref,
    array[extensions.http_header('Authorization', 'Bearer ' || v_secret)], null, null)::extensions.http_request);
  return v_res.content::jsonb;
end $$;
revoke all on function paystack_verify(text) from public, anon, authenticated;
