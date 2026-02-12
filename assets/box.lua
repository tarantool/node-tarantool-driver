box.cfg{
  listen={
    3301, 
    '/tmp/tarantoolTest.sock' -- most of the UNIX-like systems have a free access for '/tmp' folder
  }, 
  memtx_use_mvcc_engine=true,
  -- log_level=10,
  iproto_threads = 2,
  net_msg_max = 768 * 2, -- double the default
  memtx_memory = 512 * 2^20, -- 512 mb should be enough
  readahead = 16320 * 10 -- multiply the default by 10
}

if not box.schema.user.exists('test') then
  box.schema.user.create('test', {password = 'notStrongPass :('})
  box.schema.user.grant('test', 'read,write,execute', 'universe')
end

box.once('grant_user_right', function()
  box.schema.user.grant('guest', 'read,write,execute', 'universe')
end)

s = box.space.bench_memtx
if not s then
    s = box.schema.space.create('bench_memtx')
    s:format({
      {name = 'id', type = 'unsigned'},
      {name = 'line', type = 'array'}
    })
    s:create_index('hash_idx', {type = 'hash', parts = {1, 'unsigned'}})
    s:create_index('tree_idx', {type = 'tree', parts = {1, 'unsigned'}})
    s:create_index('rtree_idx', {type = 'rtree', parts = {2, 'array'}})
end

s = box.space.bench_vinyl
if not s then
    s = box.schema.space.create('bench_vinyl', {engine = 'vinyl'})
    s:format({
      {name = 'id', type = 'unsigned'},
      {name = 'line', type = 'array'}
    })
    p = s:create_index('tree_idx', {type = 'tree', parts = {1, 'unsigned'}})
end

function clear()
    box.session.su('admin')
    box.space.bench_memtx:truncate{}
    box.space.bench_vinyl:truncate{}
end

function func_arg(arg)
    return arg
end

function sum (a, b)
    return a + b
end

if not box.schema.func.exists('func_arg') then
  box.schema.func.create('func_arg')
  box.schema.user.grant('test', 'execute', 'function', 'func_arg')
end

if not box.schema.func.exists('sum') then
  box.schema.func.create('sum')
  box.schema.user.grant('test', 'execute', 'function', 'sum')
end

function sleep(s)
  os.execute("sleep " .. tonumber(n))
end

if not box.schema.func.exists('sleep') then
  box.schema.func.create('sleep')
  box.schema.user.grant('test', 'execute', 'function', 'sleep')
end