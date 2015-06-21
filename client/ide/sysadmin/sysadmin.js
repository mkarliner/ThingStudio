Template.LatestScreenUpdates.helpers({
	recentUpdates: function(){
		date = new Date();
		date.setDate(date.getDate() - 1); //Yesterday
		return Screens.find({updatedAt: {$gte: date }});
	}
	
});


Template.SysLogs.helpers({
	syslogs: function(){
		return SysLogs.find({});
	}
	
});