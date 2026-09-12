-- Granting is always limited to apps the granter holds (owners hold everything).
delete from public.qbo_role_permissions where permission = 'grant_any_app';

drop policy if exists "apps: admin insert" on public.qbo_user_apps;
create policy "apps: admin insert" on public.qbo_user_apps
  for insert to authenticated
  with check (public.qbo_can('manage_app_access') and public.qbo_has_app(app_key));

drop policy if exists "apps: admin delete" on public.qbo_user_apps;
create policy "apps: admin delete" on public.qbo_user_apps
  for delete to authenticated
  using (public.qbo_can('manage_app_access') and public.qbo_has_app(app_key));
