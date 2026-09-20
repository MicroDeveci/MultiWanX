'use strict';
'require view';
'require uci';
'require ui';
'require rpc';

/*
 * mwanx 设置页 —— 读写 /etc/config/mwanx 的 globals 段。
 * 改动即时保存，没有保存按钮。
 */

var callAutoadd = rpc.declare({ object: 'luci.mwanx', method: 'autoadd', expect: {} });
var callBackup = rpc.declare({ object: 'luci.mwanx', method: 'backup', expect: {} });
var callRestoreDefaults = rpc.declare({ object: 'luci.mwanx', method: 'restore_defaults', expect: {} });

/* 触发浏览器下载 */
function download(name, text) {
	var url = URL.createObjectURL(new Blob([ text ], { type: 'text/plain' }));
	var a = E('a', { 'href': url, 'download': name });
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

/* 字段说明统一走 form.js 渲染描述所用的类，不自定义样式 */
function desc(text) {
	return E('div', { 'class': 'cbi-value-description' }, text);
}

var METRIC_MODES = [
	[ 'none',   '仅写入配置',
	  '仅写入配置，不改变运行状态。' ],
	[ 'ifup',   '仅重启新增接口',
	  '仅对新增接口执行 ifup，该接口将重新连接。' ],
	[ 'reload', '重载网络',
	  '重载网络配置，全部出口短暂中断。' ]
];

return view.extend({

	load: function() {
		return uci.load('mwanx');
	},

	/* 取全局配置项，配置里没有时用兜底默认 */
	get: function(key, def) {
		var v = uci.get('mwanx', 'globals', key);
		return (v == null || v === '') ? def : v;
	},

	save: function(msg) {
		return uci.save().then(function() {
			return uci.apply();
		}).then(function() {
			if (msg)
				ui.addNotification(null, E('p', {}, msg), 'info');
		});
	},

	render: function() {
		var self = this;

		/* ---------- 1. 自动添加新接口 ---------- */
		var chkAuto = E('input', { 'type': 'checkbox', 'id': 'mwanx-auto-add' });
		chkAuto.checked = (self.get('auto_add', '1') == '1');
		chkAuto.addEventListener('change', function() {
			uci.set('mwanx', 'globals', 'auto_add', chkAuto.checked ? '1' : '0');
			return self.save('自动添加已' + (chkAuto.checked ? '开启' : '关闭')).then(function() {
				if (!chkAuto.checked)
					return;
				/* 开启时立刻扫一次，让已经在线但还没纳管的接口马上进来 */
				return callAutoadd().then(function(r) {
					ui.addNotification(null, E('div', {}, [
						E('p', {}, '已立即扫描一次。'),
						r.out ? E('pre', { 'style': 'font-size: 11px;' }, r.out) : ''
					]), 'info');
				});
			});
		});

		var autoRow = E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'width: 22em;' },
				E('label', { 'for': 'mwanx-auto-add' },
					[ chkAuto, ' 自动添加新接口' ])),
			E('td', { 'class': 'td' }, desc(
				'自动添加防火墙 WAN 区域中的新接口，并置于所有现有出口之后。' +
				'仅管理已获取 IPv4 地址的接口；IPv6 接口需在“MultiWanx”页面中手动添加。'))
		]);

		/* ---------- 2. 跃点应用方式 ---------- */
		var selMetric = E('select', { 'class': 'cbi-input-select' });
		var metricDesc = desc('');
		var curMode = self.get('metric_apply', 'ifup');

		METRIC_MODES.forEach(function(m) {
			var o = E('option', { 'value': m[0] }, m[1]);
			if (curMode === m[0])
				o.selected = true;
			selMetric.appendChild(o);
		});
		selMetric.addEventListener('change', function() {
			uci.set('mwanx', 'globals', 'metric_apply', selMetric.value);
			self.save('已保存：跃点应用方式');
			METRIC_MODES.forEach(function(m) {
				if (m[0] === selMetric.value)
					metricDesc.textContent = m[2];
			});
		});
		METRIC_MODES.forEach(function(m) {
			if (m[0] === curMode)
				metricDesc.textContent = m[2];
		});

		var metricRow = E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, '跃点应用方式'),
			E('td', { 'class': 'td' }, [ selMetric, metricDesc ])
		]);

		/* ---------- 3. 日志持久化 ---------- */
		var daysInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'number',
			'min': '1',
			'max': '3650',
			'style': 'width: 6em;',
			'value': self.get('log_days', '60')
		});
		var daysWrap = E('span', { 'style': 'margin-left: 10px;' }, [ '保留 ', daysInput, ' 天' ]);

		var chkLog = E('input', { 'type': 'checkbox', 'id': 'mwanx-log-persist' });
		chkLog.checked = (self.get('log_persist', '0') == '1');
		daysWrap.style.display = chkLog.checked ? '' : 'none';

		chkLog.addEventListener('change', function() {
			uci.set('mwanx', 'globals', 'log_persist', chkLog.checked ? '1' : '0');
			daysWrap.style.display = chkLog.checked ? '' : 'none';
			self.save('日志持久化已' + (chkLog.checked ? '开启' : '关闭'));
		});

		daysInput.addEventListener('change', function() {
			var v = parseInt(daysInput.value, 10);
			if (isNaN(v) || v < 1) {
				v = 60;
				daysInput.value = '60';
			}
			uci.set('mwanx', 'globals', 'log_days', String(v));
			self.save('已保存：日志保留 ' + v + ' 天');
		});

		var logRow = E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' },
				E('label', { 'for': 'mwanx-log-persist' },
					[ chkLog, ' 日志持久化' ])),
			E('td', { 'class': 'td' }, [
				daysWrap,
				desc('日志默认保存在内存中，重启后丢失。')
			])
		]);

		/* ---------- 全局参数 ---------- */
		var GPARAMS = [
			{ key: 'interval',        label: '检查间隔（秒）',
			  hint: '每轮探测之间的间隔时间（秒）。' },
			{ key: 'fail_threshold',  label: '失败阈值',
			  hint: '连续失败达到该次数后，判定出口不可用。数值越低，切换越快。' },
			{ key: 'probe_count',     label: '每轮探测包数',
			  hint: '每轮探测发送的数据包数量。' },
			{ key: 'probe_timeout',   label: '单包超时（秒）',
			  hint: '等待单个探测包响应的超时时间（秒）。' },
			{ key: 'test_ip',         label: '默认 IPv4 跟踪 IP',
			  hint: '当出口未单独指定跟踪 IP 时使用。' },
			{ key: 'test_ip6',        label: '默认 IPv6 跟踪 IP',
			  hint: '当出口未单独指定跟踪 IP 时使用。' },
			{ key: 'override_metric', label: '覆盖路由跃点',
			  hint: '插入默认路由时使用的跃点，必须小于所有出口的跃点。' }
		];

		var paramRows = GPARAMS.map(function(f) {
			var input = E('input', {
				'class': 'cbi-input-text',
				'style': 'width: 12em;',
				'value': self.get(f.key, '')
			});
			input.addEventListener('change', function() {
				uci.set('mwanx', 'globals', f.key, input.value.trim());
				self.save('已保存：' + f.label);
			});
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'width: 22em;' }, f.label),
				E('td', { 'class': 'td' }, [ input, desc(f.hint) ])
			]);
		});

		var paramTable = E('table', { 'class': 'table' }, paramRows);

		/* ---------- 配置管理 ---------- */
		var btnBackup = E('button', { 'class': 'btn cbi-button' }, '备份当前配置');
		btnBackup.addEventListener('click', function() {
			return callBackup().then(function(r) {
				var t = (r && r.text) || '';
				if (!t) {
					ui.addNotification(null, E('p', {}, '没有可备份的配置。'), 'warning');
					return;
				}
				var d = new Date();
				var name = 'mwanx-' + d.getFullYear() +
					('0' + (d.getMonth() + 1)).slice(-2) +
					('0' + d.getDate()).slice(-2) + '.uci';
				download(name, t);
				ui.addNotification(null, E('p', {}, '已导出 ' + name + '。'), 'info');
			});
		});

		var btnRestore = E('button', { 'class': 'btn cbi-button cbi-button-reset' },
			'恢复默认配置');
		btnRestore.addEventListener('click', function() {
			if (!confirm('恢复默认配置？\n\n全局设置会回到默认值，所有出口配置都会被删除。'))
				return Promise.resolve();
			if (!confirm('再次确认：全部出口将被删除，此操作无法撤销。'))
				return Promise.resolve();

			return callRestoreDefaults().then(function(r) {
				if (r.rc) {
					ui.addNotification(null, E('p', {},
						'恢复失败：' + (r.out || ('rc=' + r.rc))), 'danger');
					return;
				}
				/* 浏览器里那份 uci 缓存已经过期，重载页面拿新的值 */
				window.location.reload();
			});
		});

		/* ---------- 组装 ---------- */
		var table = E('table', { 'class': 'table' }, [ autoRow, logRow, metricRow ]);

		return E('div', {}, [
			E('h2', {}, '设置'),
			table,

			E('h3', {}, '全局设置'),
			paramTable,

			E('div', { 'class': 'cbi-page-actions' }, [ btnBackup, ' ', btnRestore ]),

			E('p', { 'class': 'cbi-value-description' }, '更改立即生效，无需重启服务。')
		]);
	}
});
