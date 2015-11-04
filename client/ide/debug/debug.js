Template.DebugBody.onRendered(function() {
	$('ul.tabs').tabs();

});

Template.DebugOverlay.events({
	'click .view-full-debug': function(e, tmpl) {
		debugOps();
	}
});

Template.DebugBody.events({
	'click .tab': function (e, tmpl) {
		// console.log("tab click this: ", e, tmpl)
		var tabs = tmpl.findAll('.tab a')
		console.log("here is tabs", tabs)
		$(tabs).removeClass('active')
		var newTab = e.target
		console.log("here is newTab", newTab)
		$thisTab = $(newTab)
		$thisTab.addClass('active');
		thisTabBlockID = $thisTab.attr('href')
		console.log("ID:", thisTabBlockID)
		$(".debug-page > div").css({"display": "none"})
		$(".debug-page " + thisTabBlockID).css({"display": "block"})
	}







	// $('div.tldtabs div').click(function(){
  //   var tab_id = $(this).attr('data-tab');
	//
	// 	$('div.tldtabs div').removeClass('current');
	// 	$('.tab-content').removeClass('current');
	//
	// 	$(this).addClass('current');
	// 	$("#"+tab_id).addClass('current');
	// });
})

Template.DebugBody.helpers({
	feeds: function() {
		return Feeds.find();
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}

		}
		catch(err){
			return err + " " + this
		}
	}
})

Template.DebugSubscribe.helpers({
	messages: function(){
		return Messages.find({});
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}

		}
		catch(err){
			return err + " " + this
		}
	}
});

Template.DebugPublish.helpers({
	outbox: function(){
		return Outbox.find({});
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}

		}
		catch(err){
			return err + " " + this
		}
	}
});
