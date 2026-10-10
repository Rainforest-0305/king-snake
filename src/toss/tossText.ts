// tossText.ts — 토스 전용 UI 문구 «9개 로케일» (2026-09-10 레인 A): 푸시 알림 동의 · 머니 리그 교차추천.
//
// ══ 왜 src/i18n/messages/*.ts 에 안 넣는가 ════════════════════════════════
//  그 9개 파일은 전부 «보호 파일»이다(tools/check_protected.mjs). reward/rewardText.ts 와 같은 이유로
//  자기 사전을 든다. 로케일 «선택»은 i18n/index.ts 의 getLocale() 을 그대로 쓴다.
//
// ══ 문체 ═══════════════════════════════════════════════════════════════════
//  기존 ko 사전의 평서형(「죽었다」·「다시 하기」)을 잇는다 — 이 게임의 목소리다. 존댓말·느낌표·
//  「~해보세요」 금지. 한 줄에 가운뎃점(·) 둘 금지. 이모지 0.
//  ★공통 지시서의 「해요체」 규칙은 이 게임에서는 «기존 목소리 유지»가 우선이라 적용하지 않았다
//    (레인 파일: 「shell.ts 안 설정 UI 와 같은 톤으로」). 릴리즈 노트는 해요체다.
//
// ══ 길이 규율 ══════════════════════════════════════════════════════════════
//  로케일마다 길이가 다르다. 행·카드는 고정폭을 «가정하지 않는다»(styles.css 에서 줄바꿈 허용).

import { getLocale } from '../i18n';

export interface TossStrings {
  /** 설정 행 라벨 */
  pushLabel: string;
  /** 행 버튼 4상태 */
  pushGet: string;
  pushBusy: string;
  pushOn: string;
  pushRetry: string;
  /** 행 아래 힌트 — 「매일 저녁 8시 30분」과 「끄기는 토스 앱 알림 설정」이 «반드시» 들어간다 */
  pushHint: string;
  /** onError 뒤 힌트 */
  pushError: string;
  /** 안내 카드 */
  pushNudgeTitle: string;
  pushNudgeSub: string;
  pushNudgeCta: string;
  /** 닫기(아이콘 버튼 aria-label) */
  close: string;
  /** 교차추천 카드 */
  xpromoLabel: string;
  xpromoTitle: string;
  xpromoSub: string;
  xpromoOpen: string;
  /** 열기가 «실패로 확인»됐을 때만 쓰는 부제(무응답은 이 문구를 쓰지 않는다 — openUrl.ts) */
  xpromoFail: string;
}

type Lang = 'en' | 'ko' | 'ja' | 'zh-Hans' | 'es' | 'pt-BR' | 'de' | 'fr' | 'ru';

const DICT: Record<Lang, TossStrings> = {
  ko: {
    pushLabel: '알림',
    pushGet: '받기',
    pushBusy: '확인 중',
    pushOn: '켜짐',
    pushRetry: '다시 켜기',
    pushHint: '부활과 부스트 횟수는 자정에 채워진다. 매일 저녁 8시 30분에 알림으로 알려준다. 끄기는 토스 앱 알림 설정에서',
    pushError: '알림 설정을 못 불러왔다. 토스 앱을 최신으로 업데이트한 뒤 다시 누르면 된다',
    pushNudgeTitle: '매일 충전 알림 받기',
    pushNudgeSub: '매일 저녁 8시 30분에 알림으로 알려준다',
    pushNudgeCta: '받기',
    close: '닫기',
    xpromoLabel: '추천',
    xpromoTitle: '머니 리그',
    xpromoSub: '1만 명 봇 리그에서 가상 투자',
    xpromoOpen: '열기',
    xpromoFail: '지금은 열 수 없다. 잠시 뒤에 다시 누르면 된다',
  },
  en: {
    pushLabel: 'Alerts',
    pushGet: 'Get',
    pushBusy: 'Checking',
    pushOn: 'On',
    pushRetry: 'Turn on again',
    pushHint: 'Revives and boosts refill at midnight. We ping you every day at 8:30 PM (KST). Turn it off in Toss app notification settings',
    pushError: "Couldn't open alert settings. Update the Toss app and tap again",
    pushNudgeTitle: 'Daily refill alert',
    pushNudgeSub: 'A daily ping at 8:30 PM (KST)',
    pushNudgeCta: 'Get',
    close: 'Close',
    xpromoLabel: 'Suggested',
    xpromoTitle: 'Money League',
    xpromoSub: 'Virtual investing in a 10,000-bot league',
    xpromoOpen: 'Open',
    xpromoFail: "Can't open it right now. Try again in a moment",
  },
  ja: {
    pushLabel: '通知',
    pushGet: '受け取る',
    pushBusy: '確認中',
    pushOn: 'オン',
    pushRetry: 'もう一度オン',
    pushHint: '復活とブーストの回数は0時に回復する。毎日20時30分(KST)に通知する。オフはトスアプリの通知設定で',
    pushError: '通知設定を読み込めなかった。トスアプリを最新にしてもう一度押す',
    pushNudgeTitle: '毎日の回復通知',
    pushNudgeSub: '毎日20時30分(KST)に通知',
    pushNudgeCta: '受け取る',
    close: '閉じる',
    xpromoLabel: 'おすすめ',
    xpromoTitle: 'マネーリーグ',
    xpromoSub: '1万体のボットリーグで仮想投資',
    xpromoOpen: '開く',
    xpromoFail: '今は開けない。少しあとでもう一度押す',
  },
  'zh-Hans': {
    pushLabel: '通知',
    pushGet: '接收',
    pushBusy: '确认中',
    pushOn: '已开启',
    pushRetry: '重新开启',
    pushHint: '复活与加速次数在零点恢复。每天 20:30(KST) 提醒一次。关闭请到 Toss 应用的通知设置',
    pushError: '无法打开通知设置。请更新 Toss 应用后再试',
    pushNudgeTitle: '每日恢复提醒',
    pushNudgeSub: '每天 20:30(KST) 提醒一次',
    pushNudgeCta: '接收',
    close: '关闭',
    xpromoLabel: '推荐',
    xpromoTitle: 'Money League',
    xpromoSub: '在一万个机器人的联赛里模拟投资',
    xpromoOpen: '打开',
    xpromoFail: '现在打不开。过一会儿再按一次',
  },
  es: {
    pushLabel: 'Avisos',
    pushGet: 'Recibir',
    pushBusy: 'Comprobando',
    pushOn: 'Activado',
    pushRetry: 'Activar de nuevo',
    pushHint: 'Revivir y aceleraciones se recargan a medianoche. Aviso cada día a las 20:30 (KST). Se apaga en los ajustes de notificaciones de la app Toss',
    pushError: 'No se pudo abrir el ajuste de avisos. Actualiza la app Toss y pulsa de nuevo',
    pushNudgeTitle: 'Aviso de recarga diaria',
    pushNudgeSub: 'Un aviso diario a las 20:30 (KST)',
    pushNudgeCta: 'Recibir',
    close: 'Cerrar',
    xpromoLabel: 'Sugerido',
    xpromoTitle: 'Money League',
    xpromoSub: 'Inversión virtual en una liga de 10.000 bots',
    xpromoOpen: 'Abrir',
    xpromoFail: 'Ahora no se puede abrir. Inténtalo en un momento',
  },
  'pt-BR': {
    pushLabel: 'Avisos',
    pushGet: 'Receber',
    pushBusy: 'Verificando',
    pushOn: 'Ligado',
    pushRetry: 'Ligar de novo',
    pushHint: 'Reviver e turbos recarregam à meia-noite. Aviso todo dia às 20:30 (KST). Para desligar, use as notificações do app Toss',
    pushError: 'Não deu para abrir os avisos. Atualize o app Toss e toque de novo',
    pushNudgeTitle: 'Aviso de recarga diária',
    pushNudgeSub: 'Um aviso diário às 20:30 (KST)',
    pushNudgeCta: 'Receber',
    close: 'Fechar',
    xpromoLabel: 'Sugestão',
    xpromoTitle: 'Money League',
    xpromoSub: 'Investimento virtual numa liga de 10 mil bots',
    xpromoOpen: 'Abrir',
    xpromoFail: 'Não dá para abrir agora. Tente de novo daqui a pouco',
  },
  de: {
    pushLabel: 'Hinweise',
    pushGet: 'Erhalten',
    pushBusy: 'Wird geprüft',
    pushOn: 'An',
    pushRetry: 'Erneut einschalten',
    pushHint: 'Wiederbelebung und Boosts füllen sich um Mitternacht auf. Hinweis täglich um 20:30 (KST). Ausschalten in den Mitteilungen der Toss-App',
    pushError: 'Hinweis-Einstellung konnte nicht geöffnet werden. Toss-App aktualisieren und erneut tippen',
    pushNudgeTitle: 'Tägliche Nachfüll-Erinnerung',
    pushNudgeSub: 'Ein Hinweis täglich um 20:30 (KST)',
    pushNudgeCta: 'Erhalten',
    close: 'Schließen',
    xpromoLabel: 'Empfehlung',
    xpromoTitle: 'Money League',
    xpromoSub: 'Virtuell investieren in einer Liga mit 10.000 Bots',
    xpromoOpen: 'Öffnen',
    xpromoFail: 'Lässt sich gerade nicht öffnen. Gleich noch mal tippen',
  },
  fr: {
    pushLabel: 'Alertes',
    pushGet: 'Recevoir',
    pushBusy: 'Vérification',
    pushOn: 'Activé',
    pushRetry: 'Réactiver',
    pushHint: "Réanimations et accélérations se rechargent à minuit. Alerte chaque jour à 20 h 30 (KST). Désactivation dans les notifications de l'app Toss",
    pushError: "Impossible d'ouvrir le réglage des alertes. Mets à jour l'app Toss et réessaie",
    pushNudgeTitle: 'Alerte de recharge quotidienne',
    pushNudgeSub: 'Une alerte par jour à 20 h 30 (KST)',
    pushNudgeCta: 'Recevoir',
    close: 'Fermer',
    xpromoLabel: 'Suggestion',
    xpromoTitle: 'Money League',
    xpromoSub: 'Investissement virtuel dans une ligue de 10 000 bots',
    xpromoOpen: 'Ouvrir',
    xpromoFail: "Impossible d'ouvrir pour le moment. Réessaie dans un instant",
  },
  ru: {
    pushLabel: 'Уведомления',
    pushGet: 'Получать',
    pushBusy: 'Проверка',
    pushOn: 'Включено',
    pushRetry: 'Включить снова',
    pushHint: 'Возрождения и ускорения восполняются в полночь. Напоминание каждый день в 20:30 (KST). Выключить можно в уведомлениях приложения Toss',
    pushError: 'Не удалось открыть настройки уведомлений. Обнови приложение Toss и нажми ещё раз',
    pushNudgeTitle: 'Ежедневное напоминание',
    pushNudgeSub: 'Одно напоминание в день в 20:30 (KST)',
    pushNudgeCta: 'Получать',
    close: 'Закрыть',
    xpromoLabel: 'Рекомендация',
    xpromoTitle: 'Money League',
    xpromoSub: 'Виртуальные инвестиции в лиге из 10 000 ботов',
    xpromoOpen: 'Открыть',
    xpromoFail: 'Сейчас не открывается. Нажми ещё раз чуть позже',
  },
};

/** 지금 로케일의 토스 문구. ★매 호출마다 getLocale() 을 다시 읽는다(언어 전환 반영). */
export function tt(): TossStrings {
  const l = getLocale() as Lang;
  return DICT[l] ?? DICT.en;
}
