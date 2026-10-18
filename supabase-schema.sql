-- ============================================================
-- MONITORA UPA — Script de criação do banco no Supabase
-- Rode isso em: Supabase > SQL Editor > New query > Run
-- ============================================================

-- Extensão necessária para gerar UUIDs
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tabela: upas
-- Cada linha é uma unidade de pronto atendimento
-- ------------------------------------------------------------
create table if not exists upas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  endereco text,
  latitude double precision not null,
  longitude double precision not null,
  criado_em timestamptz default now()
);

-- ------------------------------------------------------------
-- Tabela: atendimentos
-- Cada linha é um check-in/check-out de um paciente numa UPA
-- ------------------------------------------------------------
create table if not exists atendimentos (
  id uuid primary key default gen_random_uuid(),
  upa_id uuid references upas(id) not null,
  dispositivo_id text not null,              -- id anônimo gerado no navegador (localStorage)
  horario_chegada timestamptz not null,
  horario_saida timestamptz,
  tempo_permanencia_minutos integer,
  status text not null default 'em_andamento' -- em_andamento | finalizado | desistiu
    check (status in ('em_andamento', 'finalizado', 'desistiu')),
  criado_em timestamptz default now()
);

create index if not exists idx_atendimentos_upa on atendimentos (upa_id);
create index if not exists idx_atendimentos_status on atendimentos (status);
create index if not exists idx_atendimentos_criado_em on atendimentos (criado_em);

-- ------------------------------------------------------------
-- Row Level Security
-- Protótipo: acesso público de leitura/escrita.
-- Antes de ir para produção, restrinja essas políticas.
-- ------------------------------------------------------------
alter table upas enable row level security;
alter table atendimentos enable row level security;

create policy "Leitura publica de upas"
  on upas for select
  using (true);

create policy "Leitura publica de atendimentos"
  on atendimentos for select
  using (true);

create policy "Insercao publica de atendimentos"
  on atendimentos for insert
  with check (true);

create policy "Atualizacao publica de atendimentos"
  on atendimentos for update
  using (true);

-- ------------------------------------------------------------
-- Dados de exemplo
-- IMPORTANTE: as coordenadas abaixo são aproximadas/ilustrativas
-- (região de São Bernardo do Campo - SP). Ajuste lat/long para
-- a localização real de cada UPA antes de usar de verdade.
-- ------------------------------------------------------------
insert into upas (nome, endereco, latitude, longitude) values
('União / Alvarenga',      'São Bernardo do Campo - SP', -23.7557, -46.5068),
('Silvina / Ferrazópolis', 'São Bernardo do Campo - SP', -23.7049, -46.5489),
('Alves Dias / Assunção',  'São Bernardo do Campo - SP', -23.7242, -46.5363),
('Baeta Neves',            'São Bernardo do Campo - SP', -23.7013, -46.5515),
('Demarchi / Batistini',   'São Bernardo do Campo - SP', -23.7438, -46.5608),
('Paulicéia / Taboão',     'São Bernardo do Campo - SP', -23.6542, -46.5903),
('Riacho Grande',          'São Bernardo do Campo - SP', -23.8166, -46.5294),
('Rudge Ramos',            'São Bernardo do Campo - SP', -23.6669, -46.5802),
('Vila São Pedro',         'São Bernardo do Campo - SP', -23.6957, -46.5265);

-- ------------------------------------------------------------
-- (Opcional) dado de teste para já ver algo na lista sem
-- precisar fazer um check-in manual primeiro
-- ------------------------------------------------------------
-- insert into atendimentos (upa_id, dispositivo_id, horario_chegada, horario_saida, tempo_permanencia_minutos, status)
-- select id, 'dispositivo-teste', now() - interval '90 minutes', now(), 90, 'finalizado'
-- from upas where nome = 'União / Alvarenga';
