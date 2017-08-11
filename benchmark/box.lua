box.cfg{listen=3301}

box.once('grant_user_right', function()
  box.schema.user.grant('guest', 'read,write,execute', 'universe')
end)

box.once('counter', function()
  local counter = box.schema.space.create('counter')
  counter:create_index('primary',   {type = 'TREE', unique = true, parts = {1, 'STR'}})
end)

box.space.counter:truncate{}
