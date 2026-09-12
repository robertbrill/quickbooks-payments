-- Project-specific: this project already has admins in public.user_roles.
-- Give them admin access to the payment feed so nobody is locked out on day one.
insert into public.qbo_team (id, email, role)
select distinct ur.user_id, u.email, 'admin'
from public.user_roles ur
join auth.users u on u.id = ur.user_id
where ur.role::text in ('admin', 'super_admin')
on conflict (id) do nothing;
