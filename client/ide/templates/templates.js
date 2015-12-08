Template.ScreensHeader.events({
	'click li': function (e, tmpl) {
		var $target = $(e.target)
		var dataAt = $target.data('template-filter')
		var li = tmpl.find("ul li.current")

		$(li).removeClass("current")
		$target.addClass("current")

		console.log(dataAt)
	}
})

Template.ScreensBody.helpers({
	widgetlist: function(){
		wl =  Screens.find({  isWidget: true}, {sort: {title: 1}})
		return wl;
	},
	templatelist: function(){
		return Screens.find({$or:[{owner: Meteor.userId()}, {isWidget: false} ] }, {sort: {lowercaseTitle: 1}});
	},
	isWidget: function(){
		return this.isWidget ? "icon-ts-checkmark" : "";
	},
	widget: function(){
		return( "aa" +this.isWidget)
	}
});
