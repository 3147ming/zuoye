export interface SkillInfo {
  key: string;
  name: string;
  cost: number;
  cd: number;
  desc: string;
}

export const SKILL_INFO: SkillInfo[] = [
  { key: '1', name: '裂空·一闪', cost: 22, cd: 6, desc: '瞬身突进，斩出一道裂空刀光。' },
  { key: '2', name: '回风·刃轮', cost: 32, cd: 9, desc: '旋身引刃，八道刀气环身回旋。' },
  { key: '3', name: '烬灭·斩', cost: 45, cd: 15, desc: '蓄势引爆刀意，焚尽周身之敌。' },
];
