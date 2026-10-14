import process from 'node:process';
// Isolated PostgreSQL only: no production credentials or network access.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const name=`chill-pipe-sale-test-${process.pid}`;
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=query=>docker(['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],query);
function parallelSql(query) {
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At']);
  let out='',error='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>error+=b);
  child.on('error',reject);child.on('close',code=>code?reject(Error(error)):resolve(out));child.stdin.end(query);
 });
}
try {
 docker(['run','--rm','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
 let ready=false;
 for(let i=0;i<60;i++) {try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
 if(!ready)throw Error('Isolated PostgreSQL did not start');
 sql(`create role authenticated; create role anon; create schema auth; create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function private.is_active_pos_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
 create function private.has_pos_permission(text) returns boolean language sql stable as $$select auth.uid() is not null$$;
 create table public.pos_profiles(id uuid primary key); insert into public.pos_profiles values('00000000-0000-0000-0000-000000000001');
 create table public.pos_stock(id bigint primary key,name text,category text,quantity numeric,sub_items jsonb);
 insert into public.pos_stock values(1,'Coal','consumable',50,null),(8,'Mouth Pieces','consumable',50,null),(13,'Hookah Pipe','equipment',20,null),(14,'Flavour','consumable',null,'[{"id":"lk","name":"Lady Killer","quantity":10},{"id":"gm","name":"Gum & Mint","quantity":10}]');
 create table public.pos_orders(id bigint primary key,flavour jsonb,type text,payment text,price numeric,status text default 'active',time timestamptz,session_date date,sold_by text,shift_id uuid,pipe_returned boolean default false,delivered_at timestamptz);
 alter table public.pos_stock enable row level security; grant usage on schema public,private,auth to authenticated;
 grant select,update on public.pos_stock to authenticated;
 create policy stock_read on public.pos_stock for select to authenticated using(true);
 create policy stock_write on public.pos_stock for all to authenticated using(true) with check(true);`);
 sql(readFileSync(new URL('../supabase/atomic-sale-stock.sql',import.meta.url),'utf8'));
 const request=id=>`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false); set role authenticated; select public.record_pos_sale('{"id":${id},"flavour":"Lady Killer","type":"full","payment":"cash","price":170,"time":"2026-10-14T12:00:00Z","session_date":"2026-10-14","sold_by":"Test"}'::jsonb);`;
 await Promise.all([...Array.from({length:20},(_,i)=>parallelSql(request(1000+i))),...Array.from({length:10},()=>parallelSql(request(5000)))]);
 const result=JSON.parse(sql(`select json_build_object('orders',(select count(*) from pos_orders),'coal',(select quantity from pos_stock where name='Coal'),'pieces',(select quantity from pos_stock where name='Mouth Pieces'),'flavour',(select (value->>'quantity')::numeric from pos_stock,jsonb_array_elements(sub_items) where name='Flavour' and value->>'id'='lk'),'pipes',(select quantity from pos_stock where name='Hookah Pipe'));`).trim());
 assert.deepEqual(result,{orders:21,coal:8,pieces:8,flavour:3.994,pipes:20});
 console.log('PASS: 30 concurrent requests committed 21 unique sales and exactly 21 consumable deductions; equipment unchanged.');
 try {sql(request(5000).replace('"price":170','"price":120'));throw Error('Collision accepted');}catch(error){assert.match(error.message,/Order ID already used/);}
 assert.equal(sql('select count(*) from pos_orders;').trim(),'21');
 console.log('PASS: conflicting retries rejected without additional orders.');
 try {sql(request(6000).replace('Lady Killer','Unknown flavour'));throw Error('Invalid sale accepted');}catch(error){assert.match(error.message,/Unknown flavour/);}
 assert.equal(sql("select quantity from pos_stock where name='Coal';").trim(),'8');
 assert.equal(sql('select count(*) from pos_orders;').trim(),'21');
 console.log('PASS: invalid sale rolls back stock changes and order insertion.');
 sql("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);set role authenticated;update pos_stock set quantity=500 where name='Coal';");
 assert.equal(sql("select quantity from pos_stock where name='Coal';").trim(),'8');
 console.log('PASS: stale direct consumable write is blocked by RLS.');
 sql("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false); insert into pos_orders(id,flavour,type,payment,price,time) values(7000,'\"Lady Killer\"','refill','cash',120,'2026-10-14T12:00:00Z');");
 assert.equal(sql("select quantity from pos_stock where name='Coal';").trim(),'6');
 console.log('PASS: older direct-insert clients also deduct stock atomically.');

} finally { try {docker(['rm','-f',name]);}catch{} }
