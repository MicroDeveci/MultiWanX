'use strict';
'require view';
'require ui';
'require rpc';
'require poll';

/*
 * mwanx 运行日志 —— 后端只做 logread | grep mwanx，前端负责展示和刷新节奏。
 * 默认不自动刷新。
 */

var callLogs = rpc.declare({
	object: 'luci.mwanx',
	method: 'logs',
	params: [ 'lines' ],
	expect: {}
});

var LINE_CHOICES = [ [ 100, '100 行' ], [ 200, '200 行' ], [ 500, '500 行' ], [ 2000, '2000 行' ] ];

return view.extend({
	preEl: null,
	autoRefresh: false,
	lines: 200,
	pollFn: null,

	load: function() {
		return L.resolveDefault(callLogs(this.lines), {});
	},

	refresh: function(scroll) {
		var self = this;
		return L.resolveDefault(callLogs(this.lines), {}).then(function(r) {
			self.preEl.textContent = (r && r.text) ? r.text : '(暂无 mwanx 日志)';
			if (self.srcEl) {
				var persisted = (r && r.source === 'file');
				self.srcEl.textContent = persisted
					? '来源：持久化文件'
					: '来源：syslog';
				self.srcEl.style.color = persisted ? '#070' : '#888';
			}
			if (scroll)
				self.preEl.scrollTop = self.preEl.scrollHeight;
		});
	},

	render: function(data) {
		var self = this;

		this.preEl = E('pre', {
			'style': 'max-height: 65vh; overflow: auto; font-size: 12px; ' +
			         'line-height: 1.45; background: #f8f8f8; padding: 10px; ' +
			         'border: 1px solid #ddd; border-radius: 3px; white-space: pre;'
		}, (data && data.text) ? data.text : '(暂无 mwanx 日志)');

		/* 行数选择 */
		var sel = E('select', { 'class': 'cbi-input-select' });
		LINE_CHOICES.forEach(function(c) {
			var opt = E('option', { 'value': String(c[0]) }, c[1]);
			if (c[0] === self.lines)
				opt.selected = true;
			sel.appendChild(opt);
		});
		sel.addEventListener('change', function() {
			self.lines = parseInt(sel.value, 10);
			return self.refresh(true);
		});

		/* 自动刷新开关 */
		var chk = E('input', { 'type': 'checkbox', 'id': 'mwanx-autorefresh' });
		chk.addEventListener('change', function() {
			self.autoRefresh = chk.checked;
			if (self.autoRefresh) {
				poll.add(function() { return self.refresh(true); }, 5);
			} else {
				poll.remove();
			}
		});

		var btn = E('button', { 'class': 'btn cbi-button cbi-button-action' }, '刷新');
		btn.addEventListener('click', function() { return self.refresh(false); });

		var btnBottom = E('button', { 'class': 'btn cbi-button' }, '跳到末尾');
		btnBottom.addEventListener('click', function() {
			self.preEl.scrollTop = self.preEl.scrollHeight;
		});

		this.srcEl = E('span', { 'style': 'font-size: 12px;' }, '');

		return E('div', {}, [
			E('h2', {}, 'mwanx 运行日志'),
			E('p', { 'class': 'cbi-value-description' }, [
				'只显示 mwanx 自己的日志行。',
				E('div', {}, this.srcEl)
			]),

			E('div', { 'style': 'margin-bottom: 8px;' }, [
				E('label', { 'style': 'margin-right: 12px;' }, [ '显示 ', sel ]),
				E('label', { 'style': 'margin-right: 12px;' }, [ chk, ' 自动刷新（5 秒）' ]),
				btn, ' ', btnBottom
			]),

			this.preEl
		]);
	}
});
