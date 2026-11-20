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
  bytecode: '577aa87b88c2529dc0009dc3519dc4519d00cd7b8800d1537a8800d3537a9d00d2008800c65379a06900cc00c6547a949c7777 7105309b OP_DEFINE b175c2529dc0009dc3519dc4519d00cd537a8800d1537a8800d3537a9d00d2008800c65379a06900cc00c6547a949c7777 bd7b557e OP_DEFINE OP_DEPTH OP_1SUB OP_ROLL OP_SIZE OP_4 OP_NUMEQUALVERIFY OP_INVOKE',
  source: 'pragma solidcash ^0.51.0;\n\n// One side of a same-chain HTLC. The other side is a second instance with the\n// same secretHash, the payout locks swapped, and an earlier timeout.\ncontract AtomSwap(\n    bigint timeout,\n    bytes32 secretHash,\n    bytes payoutLock,\n    bytes refundLock,\n    bytes tokenCategory,\n    bigint tokenAmount,\n    bigint fee\n) {\n    function claim(bytes secret) {\n        require(sha256(secret) == secretHash, "secret");\n        require(tx.version == 2, "version");\n        require(this.activeInputIndex == 0, "input");\n        require(tx.inputs.length == 1, "inputs");\n        require(tx.outputs.length == 1, "outputs");\n        require(tx.outputs[0].lockingBytecode == payoutLock, "lock");\n        require(tx.outputs[0].tokenCategory == tokenCategory, "category");\n        require(tx.outputs[0].tokenAmount == tokenAmount, "amount");\n        require(tx.outputs[0].nftCommitment == 0x, "commitment");\n        require(tx.inputs[0].value > fee, "fee");\n        require(tx.outputs[0].value == tx.inputs[0].value - fee, "value");\n    }\n\n    function refund() {\n        require(tx.time >= timeout, "timeout");\n        require(tx.version == 2, "version");\n        require(this.activeInputIndex == 0, "input");\n        require(tx.inputs.length == 1, "inputs");\n        require(tx.outputs.length == 1, "outputs");\n        require(tx.outputs[0].lockingBytecode == refundLock, "lock");\n        require(tx.outputs[0].tokenCategory == tokenCategory, "category");\n        require(tx.outputs[0].tokenAmount == tokenAmount, "amount");\n        require(tx.outputs[0].nftCommitment == 0x, "commitment");\n        require(tx.inputs[0].value > fee, "fee");\n        require(tx.outputs[0].value == tx.inputs[0].value - fee, "value");\n    }\n}\n',
  debug: {
    bytecode: '33577aa87b88c2529dc0009dc3519dc4519d00cd7b8800d1537a8800d3537a9d00d2008800c65379a06900cc00c6547a949c7777047105309b8931b175c2529dc0009dc3519dc4519d00cd537a8800d1537a8800d3537a9d00d2008800c65379a06900cc00c6547a949c777704bd7b557e89748c7a82549d8a',
    sourceMap: '14:4:26:5;;;28::40;;;5:0:41:1;;;;;;',
    logs: [],
    requires: [],
    functionDebug: {
      '7105309b': {
        requires: [
          {
            ip: 4,
            line: 15,
            message: 'secret',
          },
          {
            ip: 7,
            line: 16,
            message: 'version',
          },
          {
            ip: 10,
            line: 17,
            message: 'input',
          },
          {
            ip: 13,
            line: 18,
            message: 'inputs',
          },
          {
            ip: 16,
            line: 19,
            message: 'outputs',
          },
          {
            ip: 20,
            line: 20,
            message: 'lock',
          },
          {
            ip: 25,
            line: 21,
            message: 'category',
          },
          {
            ip: 30,
            line: 22,
            message: 'amount',
          },
          {
            ip: 34,
            line: 23,
            message: 'commitment',
          },
          {
            ip: 40,
            line: 24,
            message: 'fee',
          },
          {
            ip: 49,
            line: 25,
            message: 'value',
          },
        ],
        sourceMap: '15:23:15:29;;:16::30:1;:34::44:0;:8::56:1;16:16:16:26:0;:30::31;:8::44:1;17:16:17:37:0;:41::42;:8::53:1;18:16:18:32:0;:36::37;:8::49:1;19:16:19:33:0;:37::38;:8::51:1;20:27:20:28:0;:16::45:1;:49::59:0;:8::69:1;21:27:21:28:0;:16::43:1;:47::60:0;;:8::74:1;22:27:22:28:0;:16::41:1;:45::56:0;;:8::68:1;23:27:23:28:0;:16::43:1;:47::49:0;:8::65:1;24:26:24:27:0;:16::34:1;:37::40:0;;:16:::1;:8::49;25:27:25:28:0;:16::35:1;:49::50:0;:39::57:1;:60::63:0;;:39:::1;:8::74;14:4:26:5;',
        logs: [],
      },
      bd7b557e: {
        requires: [
          {
            ip: 0,
            line: 29,
            message: 'timeout',
          },
          {
            ip: 4,
            line: 30,
            message: 'version',
          },
          {
            ip: 7,
            line: 31,
            message: 'input',
          },
          {
            ip: 10,
            line: 32,
            message: 'inputs',
          },
          {
            ip: 13,
            line: 33,
            message: 'outputs',
          },
          {
            ip: 18,
            line: 34,
            message: 'lock',
          },
          {
            ip: 23,
            line: 35,
            message: 'category',
          },
          {
            ip: 28,
            line: 36,
            message: 'amount',
          },
          {
            ip: 32,
            line: 37,
            message: 'commitment',
          },
          {
            ip: 38,
            line: 38,
            message: 'fee',
          },
          {
            ip: 47,
            line: 39,
            message: 'value',
          },
        ],
        sourceMap: '29:8:29:47:1;;30:16:30:26:0;:30::31;:8::44:1;31:16:31:37:0;:41::42;:8::53:1;32:16:32:32:0;:36::37;:8::49:1;33:16:33:33:0;:37::38;:8::51:1;34:27:34:28:0;:16::45:1;:49::59:0;;:8::69:1;35:27:35:28:0;:16::43:1;:47::60:0;;:8::74:1;36:27:36:28:0;:16::41:1;:45::56:0;;:8::68:1;37:27:37:28:0;:16::43:1;:47::49:0;:8::65:1;38:26:38:27:0;:16::34:1;:37::40:0;;:16:::1;:8::49;39:27:39:28:0;:16::35:1;:49::50:0;:39::57:1;:60::63:0;;:39:::1;:8::74;28:4:40:5;',
        logs: [],
      },
    },
  },
  functionBodies: {
    '7105309b': '577aa87b88c2529dc0009dc3519dc4519d00cd7b8800d1537a8800d3537a9d00d2008800c65379a06900cc00c6547a949c7777',
    bd7b557e: 'b175c2529dc0009dc3519dc4519d00cd537a8800d1537a8800d3537a9d00d2008800c65379a06900cc00c6547a949c7777',
  },
  fingerprint: '13c9152fd4a177353bb41630fbf1ac2c58c29da4ebdcaf36778e95e1cedcbbcf',
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
  updatedAt: '2026-11-19T19:42:19.679Z',
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
