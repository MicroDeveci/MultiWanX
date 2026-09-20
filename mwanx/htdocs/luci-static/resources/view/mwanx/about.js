'use strict';
'require view';

/*
 * mwanx 关于页 —— 版本与地址。
 */

/* 版本号手工维护，跟着每次发版改 */
var VERSION = '1.0.0';

var DOC_URL = 'https://github.com/MicroDeveci/MultiWanX';
var PROJECT_URL = 'https://github.com/MicroDeveci/MultiWanX';

return view.extend({

	render: function() {
		/* 外链另开窗口，免得把 LuCI 顶掉 */
		function link(url) {
			return E('a', { 'href': url, 'target': '_blank', 'rel': 'noopener noreferrer' }, url);
		}

		var rows = [
			[ '版本',     VERSION ],
			[ '文档地址', link(DOC_URL) ],
			[ '项目地址', link(PROJECT_URL) ]
		].map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'width: 12em;' }, r[0]),
				E('td', { 'class': 'td' }, r[1])
			]);
		});

		return E('div', {}, [
			E('h2', {}, '关于'),
			E('table', { 'class': 'table' }, rows)
		]);
	}
});
