AutoForm.setDefaultTemplateForType('afCheckbox', 'mCheckbox');

Template.afCheckbox_mCheckbox.onRendered(function() {
	function makeid() {
		var text = "";
		var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

		for( var i=0; i < 5; i++ ) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
	var uniqid = makeid();
	Template.instance().$("input").attr("id", uniqid)
	Template.instance().$("label").attr("for", uniqid)
})