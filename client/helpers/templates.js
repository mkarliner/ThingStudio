Template.templateList.helpers({
	template_list: function() {
		sns =  Screens.find({isWidget: false});
		return sns;
	}
});
