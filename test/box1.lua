#!/usr/bin/env tarantool
box.cfg{listen=33014}

if not box.schema.user.exists('test') then
  box.schema.user.create('test', {password = 'test'})
  box.schema.user.grant('test', 'execute', 'universe')
end