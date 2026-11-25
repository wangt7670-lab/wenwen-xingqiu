export const abilities=['講故事','幽默感','演講能力'];
export const names={quiz:'考考你',performance:'請開始你的表演'};
export const formats={
  quiz:{required:['prompt','answer'],fields:{prompt:'題目',answer:'參考答案',explanation:'補充解釋',series:'連續題組',sequence:'順序'}},
  performance:{required:['ability','prompt'],fields:{ability:'訓練能力',prompt:'挑戰題目',seconds:'建議時間（秒）',tips:'技巧提示'}}
};
