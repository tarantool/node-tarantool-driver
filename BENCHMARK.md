# How to

1. Start the Tarantool server on your machine with a [box.lua](assets/box.lua) config located in a `test` folder.
2. Execute the following:
    ```Bash
    npm run benchmark-write
    ```
    to fill all of the spaces with data and check the insert performance.
3. Execute the following: 
    ```Bash
    npm run benchmark-write
    ```
    to test the read performance of previously added tuples

# "Read" results
- Machine: Apple Macbook Air M2 2022 8GB RAM
- `node -v`: 24.3.0

![results table of "read" benchmark](assets/read-results-table.png)