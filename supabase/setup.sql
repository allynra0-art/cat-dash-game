-- CAT DASH Multiplayer v1. Jalankan sekali di Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.quizzes (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (length(trim(title)) between 1 and 100),
 created_at timestamptz not null default now()
);
create table if not exists public.quiz_questions (
 id uuid primary key default gen_random_uuid(), quiz_id uuid not null references public.quizzes(id) on delete cascade,
 position int not null check (position between 0 and 49),
 prompt text not null, options jsonb not null,
 correct_index int not null check (correct_index between 0 and 3),
 unique(quiz_id,position), check (jsonb_typeof(options)='array' and jsonb_array_length(options)=4)
);
create table if not exists public.rooms (
 id uuid primary key default gen_random_uuid(), code text not null unique check (code ~ '^[0-9]{6}$'),
 host_id uuid not null references auth.users(id) on delete cascade,
 quiz_id uuid not null references public.quizzes(id), status text not null default 'lobby' check (status in ('lobby','racing','finished')),
 created_at timestamptz not null default now()
);
create table if not exists public.room_players (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 nickname text not null check (length(trim(nickname)) between 1 and 20),
 cat text not null check (cat in ('orange','white','black','gray')),
 distance numeric not null default 0, energy numeric not null default 100,
 needs_quiz boolean not null default false, question_index int not null default 0,
 correct_count int not null default 0, wrong_count int not null default 0,
 last_move timestamptz not null default now(), finished_at timestamptz,
 unique(room_id,user_id)
);
create index if not exists idx_players_room on public.room_players(room_id);

alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;

drop policy if exists quizzes_owner on public.quizzes;
create policy quizzes_owner on public.quizzes for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists questions_owner on public.quiz_questions;
create policy questions_owner on public.quiz_questions for all to authenticated
 using (exists(select 1 from public.quizzes q where q.id=quiz_id and q.owner_id=auth.uid()))
 with check (exists(select 1 from public.quizzes q where q.id=quiz_id and q.owner_id=auth.uid()));

create or replace function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.room_players where room_id=p_room and user_id=auth.uid());
$$;
revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;
drop policy if exists rooms_members on public.rooms;
create policy rooms_members on public.rooms for select to authenticated using (public.is_room_member(id));
drop policy if exists players_members on public.room_players;
create policy players_members on public.room_players for select to authenticated using (public.is_room_member(room_id));

-- Room dibuat oleh pemilik kuis. Kode 6 digit unik.
create or replace function public.create_game_room(p_quiz uuid, p_name text, p_cat text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text; v_room uuid; v_try int;
begin
 if auth.uid() is null then raise exception 'Login anonim diperlukan'; end if;
 if not exists(select 1 from public.quizzes where id=p_quiz and owner_id=auth.uid()) then raise exception 'Kuis bukan milikmu'; end if;
 if not exists(select 1 from public.quiz_questions where quiz_id=p_quiz) then raise exception 'Kuis belum memiliki soal'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 20 or p_cat not in ('orange','white','black','gray') then raise exception 'Nama atau kucing tidak valid'; end if;
 for v_try in 1..30 loop
  v_code := lpad((floor(random()*1000000))::int::text,6,'0');
  begin
   insert into public.rooms(code,host_id,quiz_id) values(v_code,auth.uid(),p_quiz) returning id into v_room;
   exit;
  exception when unique_violation then null;
  end;
 end loop;
 if v_room is null then raise exception 'Gagal membuat kode room, coba lagi'; end if;
 insert into public.room_players(room_id,user_id,nickname,cat) values(v_room,auth.uid(),trim(p_name),p_cat);
 return v_code;
end; $$;

create or replace function public.join_game_room(p_code text,p_name text,p_cat text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_room public.rooms%rowtype; v_count int;
begin
 if auth.uid() is null then raise exception 'Login anonim diperlukan'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 20 or p_cat not in ('orange','white','black','gray') then raise exception 'Nama atau kucing tidak valid'; end if;
 select * into v_room from public.rooms where code=trim(p_code) for update;
 if not found then raise exception 'Kode room tidak ditemukan'; end if;
 if exists(select 1 from public.room_players where room_id=v_room.id and user_id=auth.uid()) then return v_room.id; end if;
 if v_room.status <> 'lobby' then raise exception 'Pertandingan sudah dimulai'; end if;
 select count(*) into v_count from public.room_players where room_id=v_room.id;
 if v_count>=10 then raise exception 'Room sudah penuh (10 pemain)'; end if;
 insert into public.room_players(room_id,user_id,nickname,cat) values(v_room.id,auth.uid(),trim(p_name),p_cat);
 return v_room.id;
end; $$;

create or replace function public.start_game_room(p_room uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.rooms set status='racing' where id=p_room and host_id=auth.uid() and status='lobby';
 if not found then raise exception 'Hanya pembuat room yang bisa memulai'; end if;
 update public.room_players set last_move=now() where room_id=p_room;
end; $$;

-- Pergerakan dihitung dari waktu SERVER, bukan jarak kiriman browser.
create or replace function public.move_cat(p_room uuid,p_sprint boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_p public.room_players%rowtype; v_status text; v_dt numeric; v_rate numeric; v_speed numeric; v_energy numeric; v_distance numeric;
begin
 select status into v_status from public.rooms where id=p_room;
 if v_status <> 'racing' then return; end if;
 select * into v_p from public.room_players where room_id=p_room and user_id=auth.uid() for update;
 if not found or v_p.needs_quiz or v_p.finished_at is not null then return; end if;
 v_dt:=least(0.6,greatest(0,extract(epoch from (now()-v_p.last_move))));
 if v_dt<0.08 then return; end if;
 v_rate:=case when p_sprint then 35 else 20 end;
 v_speed:=case when p_sprint then 24 else 15 end;
 -- Energi bisa habis di tengah langkah: batasi jarak pada energi tersisa.
 v_dt:=least(v_dt,v_p.energy/v_rate);
 v_energy:=greatest(0,v_p.energy-v_rate*v_dt);
 v_distance:=least(300,v_p.distance+v_speed*v_dt);
 update public.room_players set distance=v_distance,energy=v_energy,
  needs_quiz=(v_energy<=0 and v_distance<300),
  finished_at=case when v_distance>=300 then now() else finished_at end,
  last_move=now() where id=v_p.id;
 if not exists(select 1 from public.room_players where room_id=p_room and finished_at is null) then
  update public.rooms set status='finished' where id=p_room;
 end if;
end; $$;

-- Mengambil soal TANPA membocorkan kunci jawaban.
create or replace function public.current_game_question(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_p public.room_players%rowtype; v_quiz uuid; v_count int; v_q record;
begin
 select * into v_p from public.room_players where room_id=p_room and user_id=auth.uid();
 if not found or not v_p.needs_quiz then return null; end if;
 select quiz_id into v_quiz from public.rooms where id=p_room;
 select count(*) into v_count from public.quiz_questions where quiz_id=v_quiz;
 if v_count=0 then return null; end if;
 select prompt,options into v_q from public.quiz_questions where quiz_id=v_quiz
  order by position limit 1 offset (v_p.question_index % v_count);
 return jsonb_build_object('prompt',v_q.prompt,'options',v_q.options,'number',v_p.question_index+1);
end; $$;

create or replace function public.answer_game_question(p_room uuid,p_answer int)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_p public.room_players%rowtype; v_quiz uuid; v_count int; v_correct int; v_ok boolean;
begin
 if p_answer not between 0 and 3 then raise exception 'Pilihan tidak valid'; end if;
 select * into v_p from public.room_players where room_id=p_room and user_id=auth.uid() for update;
 if not found or not v_p.needs_quiz then raise exception 'Belum waktunya menjawab'; end if;
 if (select status from public.rooms where id=p_room)<>'racing' then raise exception 'Balapan tidak aktif'; end if;
 select quiz_id into v_quiz from public.rooms where id=p_room;
 select count(*) into v_count from public.quiz_questions where quiz_id=v_quiz;
 select correct_index into v_correct from public.quiz_questions where quiz_id=v_quiz
  order by position limit 1 offset (v_p.question_index % v_count);
 v_ok:=(p_answer=v_correct);
 update public.room_players set question_index=question_index+1,
  correct_count=correct_count+case when v_ok then 1 else 0 end,
  wrong_count=wrong_count+case when v_ok then 0 else 1 end,
  energy=case when v_ok then least(100,energy+65) else 0 end,
  needs_quiz=not v_ok, last_move=now() where id=v_p.id;
 return v_ok;
end; $$;

revoke all on function public.create_game_room(uuid,text,text), public.join_game_room(text,text,text), public.start_game_room(uuid), public.move_cat(uuid,boolean), public.current_game_question(uuid), public.answer_game_question(uuid,int) from public;
grant execute on function public.create_game_room(uuid,text,text), public.join_game_room(text,text,text), public.start_game_room(uuid), public.move_cat(uuid,boolean), public.current_game_question(uuid), public.answer_game_question(uuid,int) to authenticated;

do $$ begin
 alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; end $$;
do $$ begin
 alter publication supabase_realtime add table public.room_players;
exception when duplicate_object then null; end $$;
