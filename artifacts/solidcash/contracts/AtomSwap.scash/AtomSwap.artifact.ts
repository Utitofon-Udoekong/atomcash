export default {
  contractName: 'AtomSwap',
  constructorInputs: [
    {
      name: 'timeout',
      type: 'bigint',
    },
    {
      name: 'secretHash',
      type: 'bytes32',
    },
    {
      name: 'payoutLock',
      type: 'bytes',
    },
    {
      name: 'refundLock',
      type: 'bytes',
    },
    {
      name: 'tokenCategory',
      type: 'bytes',
    },
    {
      name: 'tokenAmount',
      type: 'bigint',
    },
    {
      name: 'fee',
      type: 'bigint',
    },
  ],
  abi: [
    {
      name: 'claim',
      selector: '7105309b',
      inputs: [
        {
          name: 'secret',
          type: 'bytes',
        },
      ],
      sourceEffectOrder: 'linear',
    },
    {
      name: 'refund',
      selector: 'bd7b557e',
      inputs: [],
      sourceEffectOrder: 'linear',
    },
  ],
  bytecode: '577aa87b88c2529dc0009dc3519dc4529d00cd7b8800d1537a8800d3537a9d00d20088518a8851d1008851d3009d51d2008851cc02e8039d00c6537902e80393a069528a7777 7105309b OP_DEFINE b175c2529dc0009dc3519dc4529d00cd537a8800d1537a8800d3537a9d00d20088518a8851d1008851d3009d51d2008851cc02e8039d00c6537902e80393a069528a7777 bd7b557e OP_DEFINE 51cd1976a914297bd743adb8d9061d22287470a5bbe217be6eae88ac OP_1 OP_DEFINE 00cc00c6547a9402e803949c OP_2 OP_DEFINE OP_DEPTH OP_1SUB OP_ROLL OP_SIZE OP_4 OP_NUMEQUALVERIFY OP_INVOKE',
  source: 'pragma solidcash ^0.51.0;\n\n// One side of a same-chain HTLC. The other side is a second instance with the\n// same secretHash, the payout locks swapped, and an earlier timeout.\n// Output 0 pays the counterparty or the refund. Output 1 pays the owner 1000 sats.\n// The 800-sat `fee` is what remains for the miner.\ncontract AtomSwap(\n    bigint timeout,\n    bytes32 secretHash,\n    bytes payoutLock,\n    bytes refundLock,\n    bytes tokenCategory,\n    bigint tokenAmount,\n    bigint fee\n) {\n    function claim(bytes secret) {\n        require(sha256(secret) == secretHash, "secret");\n        require(tx.version == 2, "version");\n        require(this.activeInputIndex == 0, "input");\n        require(tx.inputs.length == 1, "inputs");\n        require(tx.outputs.length == 2, "outputs");\n        require(tx.outputs[0].lockingBytecode == payoutLock, "lock");\n        require(tx.outputs[0].tokenCategory == tokenCategory, "category");\n        require(tx.outputs[0].tokenAmount == tokenAmount, "amount");\n        require(tx.outputs[0].nftCommitment == 0x, "commitment");\n        require(tx.outputs[1].lockingBytecode == 0x76a914297bd743adb8d9061d22287470a5bbe217be6eae88ac, "feeLock");\n        require(tx.outputs[1].tokenCategory == 0x, "feeCategory");\n        require(tx.outputs[1].tokenAmount == 0, "feeAmount");\n        require(tx.outputs[1].nftCommitment == 0x, "feeCommitment");\n        require(tx.outputs[1].value == 1000, "owner");\n        require(tx.inputs[0].value > fee + 1000, "fee");\n        require(tx.outputs[0].value == tx.inputs[0].value - fee - 1000, "value");\n    }\n\n    function refund() {\n        require(tx.time >= timeout, "timeout");\n        require(tx.version == 2, "version");\n        require(this.activeInputIndex == 0, "input");\n        require(tx.inputs.length == 1, "inputs");\n        require(tx.outputs.length == 2, "outputs");\n        require(tx.outputs[0].lockingBytecode == refundLock, "lock");\n        require(tx.outputs[0].tokenCategory == tokenCategory, "category");\n        require(tx.outputs[0].tokenAmount == tokenAmount, "amount");\n        require(tx.outputs[0].nftCommitment == 0x, "commitment");\n        require(tx.outputs[1].lockingBytecode == 0x76a914297bd743adb8d9061d22287470a5bbe217be6eae88ac, "feeLock");\n        require(tx.outputs[1].tokenCategory == 0x, "feeCategory");\n        require(tx.outputs[1].tokenAmount == 0, "feeAmount");\n        require(tx.outputs[1].nftCommitment == 0x, "feeCommitment");\n        require(tx.outputs[1].value == 1000, "owner");\n        require(tx.inputs[0].value > fee + 1000, "fee");\n        require(tx.outputs[0].value == tx.inputs[0].value - fee - 1000, "value");\n    }\n}\n',
  debug: {
    bytecode: '46577aa87b88c2529dc0009dc3519dc4529d00cd7b8800d1537a8800d3537a9d00d20088518a8851d1008851d3009d51d2008851cc02e8039d00c6537902e80393a069528a7777047105309b8944b175c2529dc0009dc3519dc4529d00cd537a8800d1537a8800d3537a9d00d20088518a8851d1008851d3009d51d2008851cc02e8039d00c6537902e80393a069528a777704bd7b557e891c51cd1976a914297bd743adb8d9061d22287470a5bbe217be6eae88ac51890c00cc00c6547a9402e803949c5289748c7a82549d8a',
    sourceMap: '16:4:33:5;;;35::52;;;7:0:53:1;;;;;;;;;;;;',
    logs: [],
    requires: [],
    functionDebug: {
      '7105309b': {
        requires: [
          {
            ip: 4,
            line: 17,
            message: 'secret',
          },
          {
            ip: 7,
            line: 18,
            message: 'version',
          },
          {
            ip: 10,
            line: 19,
            message: 'input',
          },
          {
            ip: 13,
            line: 20,
            message: 'inputs',
          },
          {
            ip: 16,
            line: 21,
            message: 'outputs',
          },
          {
            ip: 20,
            line: 22,
            message: 'lock',
          },
          {
            ip: 25,
            line: 23,
            message: 'category',
          },
          {
            ip: 30,
            line: 24,
            message: 'amount',
          },
          {
            ip: 34,
            line: 25,
            message: 'commitment',
          },
          {
            ip: 37,
            line: 26,
            message: 'feeLock',
          },
          {
            ip: 41,
            line: 27,
            message: 'feeCategory',
          },
          {
            ip: 45,
            line: 28,
            message: 'feeAmount',
          },
          {
            ip: 49,
            line: 29,
            message: 'feeCommitment',
          },
          {
            ip: 53,
            line: 30,
            message: 'owner',
          },
          {
            ip: 61,
            line: 31,
            message: 'fee',
          },
          {
            ip: 64,
            line: 32,
            message: 'value',
          },
        ],
        logs: [],
        sourceMap: '17:23:17:29;;:16::30:1;:34::44:0;:8::56:1;18:16:18:26:0;:30::31;:8::44:1;19:16:19:37:0;:41::42;:8::53:1;20:16:20:32:0;:36::37;:8::49:1;21:16:21:33:0;:37::38;:8::51:1;22:27:22:28:0;:16::45:1;:49::59:0;:8::69:1;23:27:23:28:0;:16::43:1;:47::60:0;;:8::74:1;24:27:24:28:0;:16::41:1;:45::56:0;;:8::68:1;25:27:25:28:0;:16::43:1;:47::49:0;:8::65:1;26:27:26:28:0;;:8::114:1;27:27:27:28:0;:16::43:1;:47::49:0;:8::66:1;28:27:28:28:0;:16::41:1;:45::46:0;:8::61:1;29:27:29:28:0;:16::43:1;:47::49:0;:8::68:1;30:27:30:28:0;:16::35:1;:39::43:0;:8::54:1;31:26:31:27:0;:16::34:1;:37::40:0;;:43::47;:37:::1;:16;:8::56;32:27:32:28:0;;16:4:33:5:1;',
      },
      bd7b557e: {
        requires: [
          {
            ip: 0,
            line: 36,
            message: 'timeout',
          },
          {
            ip: 4,
            line: 37,
            message: 'version',
          },
          {
            ip: 7,
            line: 38,
            message: 'input',
          },
          {
            ip: 10,
            line: 39,
            message: 'inputs',
          },
          {
            ip: 13,
            line: 40,
            message: 'outputs',
          },
          {
            ip: 18,
            line: 41,
            message: 'lock',
          },
          {
            ip: 23,
            line: 42,
            message: 'category',
          },
          {
            ip: 28,
            line: 43,
            message: 'amount',
          },
          {
            ip: 32,
            line: 44,
            message: 'commitment',
          },
          {
            ip: 35,
            line: 45,
            message: 'feeLock',
          },
          {
            ip: 39,
            line: 46,
            message: 'feeCategory',
          },
          {
            ip: 43,
            line: 47,
            message: 'feeAmount',
          },
          {
            ip: 47,
            line: 48,
            message: 'feeCommitment',
          },
          {
            ip: 51,
            line: 49,
            message: 'owner',
          },
          {
            ip: 59,
            line: 50,
            message: 'fee',
          },
          {
            ip: 62,
            line: 51,
            message: 'value',
          },
        ],
        logs: [],
        sourceMap: '36:8:36:47:1;;37:16:37:26:0;:30::31;:8::44:1;38:16:38:37:0;:41::42;:8::53:1;39:16:39:32:0;:36::37;:8::49:1;40:16:40:33:0;:37::38;:8::51:1;41:27:41:28:0;:16::45:1;:49::59:0;;:8::69:1;42:27:42:28:0;:16::43:1;:47::60:0;;:8::74:1;43:27:43:28:0;:16::41:1;:45::56:0;;:8::68:1;44:27:44:28:0;:16::43:1;:47::49:0;:8::65:1;45:27:45:28:0;;:8::114:1;46:27:46:28:0;:16::43:1;:47::49:0;:8::66:1;47:27:47:28:0;:16::41:1;:45::46:0;:8::61:1;48:27:48:28:0;:16::43:1;:47::49:0;:8::68:1;49:27:49:28:0;:16::35:1;:39::43:0;:8::54:1;50:26:50:27:0;:16::34:1;:37::40:0;;:43::47;:37:::1;:16;:8::56;51:27:51:28:0;;35:4:52:5:1;',
      },
    },
    invokeDebug: {
      '1': {
        bytecode: '51cd1976a914297bd743adb8d9061d22287470a5bbe217be6eae88ac',
        name: 'outlined source span 1',
        requires: [],
        logs: [],
        sourceMap: '26:27:26:28;:16::45:1;:49::101:0',
      },
      '2': {
        bytecode: '00cc00c6547a9402e803949c',
        name: 'outlined source span 2',
        requires: [],
        logs: [],
        sourceMap: '32:27:32:28;:16::35:1;:49::50:0;:39::57:1;:60::63:0;;:39:::1;:66::70:0;:39:::1;:8::81',
      },
    },
  },
  functionBodies: {
    '7105309b': '577aa87b88c2529dc0009dc3519dc4529d00cd7b8800d1537a8800d3537a9d00d20088518a8851d1008851d3009d51d2008851cc02e8039d00c6537902e80393a069528a7777',
    bd7b557e: 'b175c2529dc0009dc3519dc4529d00cd537a8800d1537a8800d3537a9d00d20088518a8851d1008851d3009d51d2008851cc02e8039d00c6537902e80393a069528a7777',
  },
  fingerprint: '604dc2b49ae4900de05b7d2add001af25ea223ef3cbb99196307ff5adb09e592',
  compiler: {
    name: 'solidc',
    version: '0.51.1',
    options: {
      evmCompat: false,
      enforceFunctionParameterTypes: true,
      enforceLocktimeGuard: true,
      enforceFinalRequire: true,
      allowUnsafeOperations: false,
      commitmentLimit: 128,
      messageBus: false,
    },
  },
  updatedAt: '2026-11-20T07:09:55.700Z',
  invocationAnalysis: {
    version: 1,
    protocolVersions: [
      1,
    ],
    functions: [
      {
        id: 0,
        name: 'claim',
        arity: 1,
        entryPoint: true,
        selector: '7105309b',
        calls: [],
        closure: [
          0,
        ],
        component: 0,
        recursive: false,
        reads: [],
        writes: [],
        effects: [],
        unknown: false,
        bounded: true,
        maximumDirectInvocations: 0,
      },
      {
        id: 1,
        name: 'refund',
        arity: 0,
        entryPoint: true,
        selector: 'bd7b557e',
        calls: [],
        closure: [
          1,
        ],
        component: 1,
        recursive: false,
        reads: [],
        writes: [],
        effects: [],
        unknown: false,
        bounded: true,
        maximumDirectInvocations: 0,
      },
    ],
    components: [
      {
        id: 0,
        functions: [
          0,
        ],
        recursive: false,
      },
      {
        id: 1,
        functions: [
          1,
        ],
        recursive: false,
      },
    ],
  },
} as const;
