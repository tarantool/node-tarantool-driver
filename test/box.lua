#!/usr/bin/env tarantool

box.cfg{listen=33013}

lp = {
   test = 'test',
   test_empty = '',
   test_big = '123456789012345678901234567890123456789012345678901234567890' -- '1234567890' * 6
}

# Create user `test`
for k, v in pairs(lp) do
   if #box.space._user.index.name:select{k} == 0 then
      box.schema.user.create(k, { password = v })
      if k == 'test' then
         box.schema.user.grant('test', 'read', 'space', '_space')
         box.schema.user.grant('test', 'read', 'space', '_index')
         box.schema.user.grant('test', 'execute', 'universe')
      end
   end
end

# Create space `test`
if not box.space.test then
   local test = box.schema.space.create('test')
   test:create_index('primary',   {type = 'TREE', unique = true, parts = {1, 'NUM'}})
   test:create_index('secondary', {type = 'TREE', unique = false, parts = {2, 'NUM', 3, 'STR'}})
   box.schema.user.grant('test', 'read,write,execute', 'space', 'test')
end

# Delete space `test`
function test_delete(num)
   box.space.test:delete{num}
end

function myprint(some)
    print(some)
end

# Create space `msgpack` and fill it with data
if not box.space.msgpack then
   local msgpack = box.schema.space.create('msgpack')
   msgpack:create_index('primary', {parts = {1, 'NUM'}})
   box.schema.user.grant('test', 'read,write', 'space', 'msgpack')
   msgpack:insert{1, 'float as key', {[2.7] = {1, 2, 3}}}
   msgpack:insert{2, 'array as key', {[{2, 7}] = {1, 2, 3}}}
   msgpack:insert{3, 'array with float key as key', {[{[2.7] = 3, [7] = 7}] = {1, 2, 3}}}
   msgpack:insert{6, 'array with string key as key', {['megusta'] = {1, 2, 3}}}
end

# Create space `batched`
if not box.space.batched then
    local batched = box.schema.space.create('batched')
    batched:create_index('primary', {type = 'TREE', unique = true, parts = {1, 'NUM'}})
    box.schema.user.grant('test', 'read,write,execute', 'space', 'batched')
end

function batch (data)
    print(data)
    for index,value in pairs(data) do
        box.space.batched:insert(value)
    end
end

function myget(id)
    val = box.space.batched:select{id}
    return val[1]
end

if not box.space.toaddmore then
    local toaddmore = box.schema.space.create('toaddmore')
    toaddmore:create_index('primary', {type = 'TREE', unique = true, parts = {1, 'STR'}})
    box.schema.user.grant('test', 'read,write,execute', 'space', 'toaddmore')
    box.schema.user.grant('test', 'read,write,execute', 'space', '_index')
end

if not box.space.upstest then
    local s = box.schema.space.create('upstest')
    s:create_index('primary', {type = 'TREE', unique = true, parts = {1, 'NUM'}})
    box.schema.user.grant('test', 'read,write,execute', 'space', 'upstest')
end

function clearaddmore()
    local values = box.space.toaddmore:select{}
    for k,v in pairs(values) do
        if v[1] then
            box.space.toaddmore:delete{v[1]}
        end
    end
end

# Create functions

if not box.schema.func.exists('clearaddmore') then
  box.schema.func.create('clearaddmore')
  box.schema.user.grant('test', 'execute', 'function', 'clearaddmore')
end

if not box.schema.func.exists('myget') then
  box.schema.func.create('myget')
  box.schema.user.grant('test', 'execute', 'function', 'myget')
end

if not box.schema.func.exists('batch') then
  box.schema.func.create('batch')
  box.schema.user.grant('test', 'execute', 'function', 'batch')
end

if not box.schema.func.exists('myprint') then
  box.schema.func.create('myprint')
  box.schema.user.grant('test', 'execute', 'function', 'myprint')
end

if not box.schema.func.exists('test_delete') then
  box.schema.func.create('test_delete')
  box.schema.user.grant('test', 'execute', 'function', 'test_delete')
end
