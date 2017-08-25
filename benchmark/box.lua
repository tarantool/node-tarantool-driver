box.cfg{listen=3301}

box.once('grant_user_right', function()
  box.schema.user.grant('guest', 'read,write,execute', 'universe')
end)

box.once('counter', function()
  local counter = box.schema.space.create('counter')
  counter:create_index('primary',   {type = 'TREE', unique = true, parts = {1, 'STR'}})
end)

s = box.space.bench
if not s then
    s = box.schema.space.create('bench')
    p = s:create_index('primary', {type = 'hash', parts = {1, 'unsigned'}})
end

box.space.counter:truncate{}
