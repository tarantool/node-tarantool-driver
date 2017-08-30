box.cfg{listen=3301}

user = box.user
if not user then
  box.schema.user.grant('test', 'execute', 'universe')
end

box.once('grant_user_right', function()
  box.schema.user.grant('guest', 'read,write,execute', 'universe')
end)

c = box.space.counter
if not c then
    c = box.schema.space.create('counter')
    pr = c:create_index('primary', {type = 'TREE', unique = true, parts = {1, 'STR'}})
    c:insert({'test', 1337, 'Some text.'})
end

s = box.space.bench
if not s then
    s = box.schema.space.create('bench')
    p = s:create_index('primary', {type = 'hash', parts = {1, 'num'}})
end

function clear()
    box.session.su('admin')
    box.space.bench:truncate{}
end