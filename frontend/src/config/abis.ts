/**
 * Minimal ABI fragments for the contracts the UI touches.
 *
 * NAMING: the router's `...ETH...` functions move native KASH. `ETH` is inherited
 * Uniswap V2 ABI terminology and must never be shown to users (llm.txt s12, s41).
 */

export const erc20Abi = [
  {type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{type: 'string'}]},
  {type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{type: 'string'}]},
  {type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{type: 'uint8'}]},
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{name: 'owner', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      {name: 'owner', type: 'address'},
      {name: 'spender', type: 'address'},
    ],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'spender', type: 'address'},
      {name: 'value', type: 'uint256'},
    ],
    outputs: [{type: 'bool'}],
  },
] as const;

export const factoryAbi = [
  {
    type: 'function',
    name: 'getPair',
    stateMutability: 'view',
    inputs: [
      {name: 'tokenA', type: 'address'},
      {name: 'tokenB', type: 'address'},
    ],
    outputs: [{type: 'address'}],
  },
  {type: 'function', name: 'allPairsLength', stateMutability: 'view', inputs: [], outputs: [{type: 'uint256'}]},
  {
    type: 'function',
    name: 'allPairs',
    stateMutability: 'view',
    inputs: [{name: 'index', type: 'uint256'}],
    outputs: [{type: 'address'}],
  },
  {
    type: 'event',
    name: 'PairCreated',
    inputs: [
      {name: 'token0', type: 'address', indexed: true},
      {name: 'token1', type: 'address', indexed: true},
      {name: 'pair', type: 'address', indexed: false},
      {name: 'allPairsLength', type: 'uint256', indexed: false},
    ],
  },
] as const;

export const pairAbi = [
  {type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{type: 'address'}]},
  {type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{type: 'address'}]},
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {name: 'reserve0', type: 'uint112'},
      {name: 'reserve1', type: 'uint112'},
      {name: 'blockTimestampLast', type: 'uint32'},
    ],
  },
  {type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{type: 'uint256'}]},
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{name: 'owner', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'spender', type: 'address'},
      {name: 'value', type: 'uint256'},
    ],
    outputs: [{type: 'bool'}],
  },
] as const;

export const routerAbi = [
  {type: 'function', name: 'factory', stateMutability: 'pure', inputs: [], outputs: [{type: 'address'}]},
  {type: 'function', name: 'WETH', stateMutability: 'pure', inputs: [], outputs: [{type: 'address'}]},
  {type: 'function', name: 'WKASH', stateMutability: 'pure', inputs: [], outputs: [{type: 'address'}]},
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      {name: 'amountIn', type: 'uint256'},
      {name: 'path', type: 'address[]'},
    ],
    outputs: [{type: 'uint256[]'}],
  },
  {
    type: 'function',
    name: 'getAmountsIn',
    stateMutability: 'view',
    inputs: [
      {name: 'amountOut', type: 'uint256'},
      {name: 'path', type: 'address[]'},
    ],
    outputs: [{type: 'uint256[]'}],
  },
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'amountIn', type: 'uint256'},
      {name: 'amountOutMin', type: 'uint256'},
      {name: 'path', type: 'address[]'},
      {name: 'to', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [{type: 'uint256[]'}],
  },
  {
    // Native KASH in.
    type: 'function',
    name: 'swapExactETHForTokens',
    stateMutability: 'payable',
    inputs: [
      {name: 'amountOutMin', type: 'uint256'},
      {name: 'path', type: 'address[]'},
      {name: 'to', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [{type: 'uint256[]'}],
  },
  {
    // Native KASH out.
    type: 'function',
    name: 'swapExactTokensForETH',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'amountIn', type: 'uint256'},
      {name: 'amountOutMin', type: 'uint256'},
      {name: 'path', type: 'address[]'},
      {name: 'to', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [{type: 'uint256[]'}],
  },
  {
    type: 'function',
    name: 'addLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'tokenA', type: 'address'},
      {name: 'tokenB', type: 'address'},
      {name: 'amountADesired', type: 'uint256'},
      {name: 'amountBDesired', type: 'uint256'},
      {name: 'amountAMin', type: 'uint256'},
      {name: 'amountBMin', type: 'uint256'},
      {name: 'to', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [
      {name: 'amountA', type: 'uint256'},
      {name: 'amountB', type: 'uint256'},
      {name: 'liquidity', type: 'uint256'},
    ],
  },
  {
    // Adds native KASH liquidity.
    type: 'function',
    name: 'addLiquidityETH',
    stateMutability: 'payable',
    inputs: [
      {name: 'token', type: 'address'},
      {name: 'amountTokenDesired', type: 'uint256'},
      {name: 'amountTokenMin', type: 'uint256'},
      {name: 'amountETHMin', type: 'uint256'},
      {name: 'to', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [
      {name: 'amountToken', type: 'uint256'},
      {name: 'amountETH', type: 'uint256'},
      {name: 'liquidity', type: 'uint256'},
    ],
  },
  {
    type: 'function',
    name: 'removeLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'tokenA', type: 'address'},
      {name: 'tokenB', type: 'address'},
      {name: 'liquidity', type: 'uint256'},
      {name: 'amountAMin', type: 'uint256'},
      {name: 'amountBMin', type: 'uint256'},
      {name: 'to', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [
      {name: 'amountA', type: 'uint256'},
      {name: 'amountB', type: 'uint256'},
    ],
  },
  {
    // Removes liquidity and returns native KASH.
    type: 'function',
    name: 'removeLiquidityETH',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'token', type: 'address'},
      {name: 'liquidity', type: 'uint256'},
      {name: 'amountTokenMin', type: 'uint256'},
      {name: 'amountETHMin', type: 'uint256'},
      {name: 'to', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [
      {name: 'amountToken', type: 'uint256'},
      {name: 'amountETH', type: 'uint256'},
    ],
  },
] as const;
