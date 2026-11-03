# 演示项目（v1.0.0）

| 文件 | 内容 | 打开后看什么 |
|---|---|---|
| `analog-divider.circuit.json` | E1 分压（5V-1k-1k） | 万用表电压档中点 2.500V；电阻档 2.000kΩ |
| `digital-nand.circuit.json` | E7 74LS00 与非门 | 拨两个逻辑开关，看 D1 指示灯与真值表 |
| `mixed-oscillator.circuit.json` | 比较器弛张振荡器（RC 10k/10µF + 施密特） | 波形面板运行 1s，看数字阶梯与电容曲线同轴 |

打开方式：数据面板 → 导出 → 打开项目 → 选文件；或把 JSON 内容粘贴到控制台
`__labBoard.model.loadCircuit(<对象>)` 后 `simulateNow('demo')`。

演示步骤（录屏替代脚本）：
1. `node server.mjs` → 打开 http://127.0.0.1:5360/
2. 打开"示例 E1：电阻分压" → 右栏万用表电压档选测点 → 读数 2.500V
3. 切到"示例 E8：74LS74 分频" → 波形面板运行 10ms → 示波器 CH1 挂 Q → 频率 500Hz
4. 打开"示例 E5：NPN 开关" → 指导书点"生成实验报告" → 浏览器打开报告并 Ctrl+P
