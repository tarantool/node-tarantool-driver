docker run \
    --name tarantool-test-box \
    -v `pwd`/assets:/opt/tarantool \
    -v /tmp:/tmp \
    --rm \
    -d \
    -p 3301:3301 \
    -e TT_DATABASE_USE_MVCC_ENGINE=true \
    -e TT_IPROTO_THREADS=2 \
    tarantool/tarantool:latest tarantool /opt/tarantool/box.lua